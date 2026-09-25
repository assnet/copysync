import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UploadSessionSweeper, type SweepableUploadStore } from './UploadSessionSweeper';

const MINUTE = 60_000;
const MIB = 1024 * 1024;
const TTL = 120 * MINUTE;
const INTERVAL = 10 * MINUTE;
const T0 = new Date('2026-09-25T12:00:00.000Z');

/** Disco de 10 GiB: reserva calculada = 1 GiB, alerta abaixo de 2 GiB livres. */
const TOTAL = 10 * 1024 * MIB;
const GIB = 1024 * MIB;

/** Store falso: cada upload tem só a última atividade; `listExpired` aplica o TTL recebido. */
function fakeStore(lastActivity: Record<string, Date>, freeBytes = 5 * GIB) {
  const uploads = new Map(Object.entries(lastActivity));
  const store = {
    listExpired: vi.fn(async (now: Date, ttlMs: number) =>
      [...uploads].filter(([, at]) => now.getTime() - at.getTime() > ttlMs).map(([id]) => id),
    ),
    // Reconfere a atividade como o store real: só apaga o que continua vencido.
    discardIfExpired: vi.fn(async (uploadId: string, now: Date, ttlMs: number) => {
      const at = uploads.get(uploadId);
      if (!at || now.getTime() - at.getTime() <= ttlMs) return false;
      uploads.delete(uploadId);
      return true;
    }),
    diskStats: vi.fn(async () => ({ totalBytes: TOTAL, freeBytes })),
    openReservedBytes: vi.fn(async () => 300 * MIB),
  } satisfies SweepableUploadStore;
  return { store, uploads };
}

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function minutesAgo(minutes: number): Date {
  return new Date(T0.getTime() - minutes * MINUTE);
}

/** Deixa as promessas pendentes andarem sem avançar o relógio falso. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('UploadSessionSweeper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('apaga só os uploads parados além do TTL, usando o relógio injetado', async () => {
    const { store, uploads } = fakeStore({
      abandonado: minutesAgo(121),
      consumidoAntigo: minutesAgo(500),
      emAndamento: minutesAgo(30),
      noLimite: minutesAgo(120),
    });
    const sweeper = new UploadSessionSweeper({ store, ttlMs: TTL, now: () => T0, logger: fakeLogger() });

    await sweeper.runOnce();

    expect(store.listExpired).toHaveBeenCalledWith(T0, TTL);
    expect(store.discardIfExpired.mock.calls.map(([id]) => id).sort()).toEqual(['abandonado', 'consumidoAntigo']);
    expect(store.discardIfExpired).toHaveBeenCalledWith('abandonado', T0, TTL);
    expect([...uploads.keys()].sort()).toEqual(['emAndamento', 'noLimite']);
  });

  it('upload que voltou a receber partes entre a listagem e o descarte não é apagado', async () => {
    const { store, uploads } = fakeStore({ retomado: minutesAgo(200), abandonado: minutesAgo(200) });
    store.listExpired.mockImplementationOnce(async () => {
      uploads.set('retomado', T0); // parte chegou depois da listagem
      return ['retomado', 'abandonado'];
    });
    const logger = fakeLogger();
    const sweeper = new UploadSessionSweeper({ store, ttlMs: TTL, now: () => T0, logger });

    await sweeper.runOnce();

    expect(store.discardIfExpired).toHaveBeenCalledWith('retomado', T0, TTL);
    expect([...uploads.keys()]).toEqual(['retomado']);
    expect(logger.info).toHaveBeenCalledWith({ removed: 1 }, expect.any(String));
  });

  it('um upload que falha ao apagar não impede a limpeza dos outros', async () => {
    const { store, uploads } = fakeStore({ travado: minutesAgo(200), abandonado: minutesAgo(200) });
    store.discardIfExpired.mockImplementationOnce(async () => {
      throw new Error('EACCES');
    });
    const logger = fakeLogger();
    const sweeper = new UploadSessionSweeper({ store, ttlMs: TTL, now: () => T0, logger });

    await sweeper.runOnce();

    expect(store.discardIfExpired).toHaveBeenCalledTimes(2);
    expect(uploads.size).toBe(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('alerta quando o espaço livre fica abaixo de duas vezes a reserva', async () => {
    const { store } = fakeStore({}, 2 * GIB - 1);
    const logger = fakeLogger();
    const sweeper = new UploadSessionSweeper({ store, ttlMs: TTL, now: () => T0, logger });

    await sweeper.runOnce();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
      freeBytes: 2 * GIB - 1,
      totalBytes: TOTAL,
      reserveBytes: GIB,
      openReservedBytes: 300 * MIB,
    });
  });

  it('não alerta com o espaço livre em duas vezes a reserva ou mais', async () => {
    const { store } = fakeStore({}, 2 * GIB);
    const logger = fakeLogger();
    const sweeper = new UploadSessionSweeper({ store, ttlMs: TTL, now: () => T0, logger });

    await sweeper.runOnce();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('usa a reserva configurada quando ela é informada', async () => {
    const { store } = fakeStore({}, 3 * GIB);
    const logger = fakeLogger();
    const reserveFor = vi.fn(() => 2 * GIB);
    const sweeper = new UploadSessionSweeper({ store, ttlMs: TTL, now: () => T0, logger, reserveFor });

    await sweeper.runOnce();

    expect(reserveFor).toHaveBeenCalledWith(TOTAL);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('uma varredura ainda em curso não é sobreposta por outra', async () => {
    const { store } = fakeStore({ abandonado: minutesAgo(200) });
    let release!: () => void;
    store.listExpired.mockImplementationOnce(
      () => new Promise<string[]>((resolve) => (release = () => resolve(['abandonado']))),
    );
    const sweeper = new UploadSessionSweeper({ store, ttlMs: TTL, now: () => T0, logger: fakeLogger() });

    const first = sweeper.runOnce();
    const second = sweeper.runOnce();
    await flush();
    expect(store.listExpired).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([first, second]);
    expect(store.discardIfExpired).toHaveBeenCalledTimes(1);

    await sweeper.runOnce();
    expect(store.listExpired).toHaveBeenCalledTimes(2);
  });

  it('o intervalo não dispara outra varredura enquanto a anterior não termina', async () => {
    const { store } = fakeStore({});
    let release!: () => void;
    store.listExpired.mockImplementationOnce(
      () => new Promise<string[]>((resolve) => (release = () => resolve([]))),
    );
    const sweeper = new UploadSessionSweeper({
      store,
      ttlMs: TTL,
      intervalMs: INTERVAL,
      now: () => T0,
      logger: fakeLogger(),
    });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(store.listExpired).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(store.listExpired).toHaveBeenCalledTimes(2);
    sweeper.stop();
  });

  it('erro numa varredura é registrado e as seguintes continuam no intervalo', async () => {
    const { store } = fakeStore({ abandonado: minutesAgo(200) });
    store.listExpired.mockRejectedValueOnce(new Error('EIO'));
    const logger = fakeLogger();
    const sweeper = new UploadSessionSweeper({ store, ttlMs: TTL, intervalMs: INTERVAL, now: () => T0, logger });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(store.discardIfExpired).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(store.discardIfExpired).toHaveBeenCalledWith('abandonado', T0, TTL);
    sweeper.stop();
  });

  it('falha ao ler o disco é registrada sem impedir a limpeza', async () => {
    const { store, uploads } = fakeStore({ abandonado: minutesAgo(200) });
    store.diskStats.mockRejectedValueOnce(new Error('ENOENT'));
    const logger = fakeLogger();
    const sweeper = new UploadSessionSweeper({ store, ttlMs: TTL, now: () => T0, logger });

    await expect(sweeper.runOnce()).resolves.toBeUndefined();

    expect(uploads.size).toBe(0);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('roda uma vez ao iniciar e depois a cada intervalo, sem segurar o processo', async () => {
    const { store } = fakeStore({});
    // Envolve o `setInterval` do relógio falso só para observar o `unref` do timer criado.
    const fakeSetInterval = globalThis.setInterval;
    const scheduled: ReturnType<typeof setInterval>[] = [];
    const spy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((handler: () => void, ms: number) => {
      const timer = fakeSetInterval(handler, ms);
      vi.spyOn(timer, 'unref');
      scheduled.push(timer);
      return timer;
    }) as typeof setInterval);
    // Sem `intervalMs`: vale o padrão de 10 minutos.
    const sweeper = new UploadSessionSweeper({ store, ttlMs: TTL, now: () => T0, logger: fakeLogger() });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.listExpired).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(store.listExpired).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(expect.any(Function), INTERVAL);
    expect(scheduled[0]?.unref).toHaveBeenCalled();

    sweeper.stop();
    spy.mockRestore();
  });

  it('depois de parar, nenhuma varredura nova é agendada', async () => {
    const { store } = fakeStore({});
    const sweeper = new UploadSessionSweeper({
      store,
      ttlMs: TTL,
      intervalMs: INTERVAL,
      now: () => T0,
      logger: fakeLogger(),
    });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(0);
    sweeper.stop();
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);

    expect(store.listExpired).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('iniciar duas vezes não cria um segundo agendamento', async () => {
    const { store } = fakeStore({});
    const sweeper = new UploadSessionSweeper({
      store,
      ttlMs: TTL,
      intervalMs: INTERVAL,
      now: () => T0,
      logger: fakeLogger(),
    });

    sweeper.start();
    sweeper.start();
    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(store.listExpired).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    sweeper.stop();
  });
});
