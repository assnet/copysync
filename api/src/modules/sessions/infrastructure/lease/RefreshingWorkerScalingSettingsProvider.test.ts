import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IWorkerScalingSettingsRepository,
  WorkerScalingSettingsRecord,
} from '../../domain/contracts/IWorkerScalingSettingsRepository';
import { RefreshingWorkerScalingSettingsProvider } from './RefreshingWorkerScalingSettingsProvider';

const envDefaults = { maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 5 };
const record = (value: unknown, by: string | null = 'admin-1'): WorkerScalingSettingsRecord => ({
  value,
  updatedAt: new Date('2026-11-11T00:00:00Z'),
  updatedById: by,
});

function setup(refreshMs?: number, readTimeoutMs?: number) {
  const repository = { get: vi.fn(), save: vi.fn() } as unknown as IWorkerScalingSettingsRepository & {
    get: ReturnType<typeof vi.fn>;
  };
  const log = { warn: vi.fn() };
  const provider = new RefreshingWorkerScalingSettingsProvider({ repository, envDefaults, logger: log, refreshMs, readTimeoutMs });
  return { repository, log, provider };
}

describe('RefreshingWorkerScalingSettingsProvider', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('nasce com o default da env, sem I/O', () => {
    const { repository, provider } = setup();
    const { value, origin } = provider.current();
    expect(value.maxSessionsPerWorker).toBe(40);
    expect(value.maxPendingLoginsPerWorker).toBe(5);
    expect(value.scalerMode).toBe('off');
    expect(origin.maxSessionsPerWorker).toBe('default');
    expect(repository.get).not.toHaveBeenCalled();
  });

  it('troca o valor após refresh', async () => {
    const { repository, provider } = setup();
    repository.get.mockResolvedValueOnce(record({ maxSessionsPerWorker: 80 }));
    await provider.refresh();
    expect(provider.current().value.maxSessionsPerWorker).toBe(80);
    expect(provider.current().origin.maxSessionsPerWorker).toBe('saved');
    expect(provider.current().value.maxPendingLoginsPerWorker).toBe(5);
  });

  it('sem linha volta ao default', async () => {
    const { repository, provider } = setup();
    repository.get.mockResolvedValueOnce(record({ maxSessionsPerWorker: 80 })).mockResolvedValueOnce(null);
    await provider.refresh();
    await provider.refresh();
    expect(provider.current().value.maxSessionsPerWorker).toBe(40);
  });

  it('falha preserva o anterior e loga warn uma vez por sequência', async () => {
    const { repository, log, provider } = setup();
    repository.get
      .mockResolvedValueOnce(record({ maxSessionsPerWorker: 80 }))
      .mockRejectedValueOnce(new Error('db down'))
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(record({ maxSessionsPerWorker: 90 }))
      .mockRejectedValueOnce(new Error('db down'));
    await provider.refresh();
    await expect(provider.refresh()).resolves.toBeUndefined();
    await provider.refresh();
    expect(provider.current().value.maxSessionsPerWorker).toBe(80);
    expect(log.warn).toHaveBeenCalledTimes(1);
    await provider.refresh();
    expect(provider.current().value.maxSessionsPerWorker).toBe(90);
    await provider.refresh();
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(provider.current().value.maxSessionsPerWorker).toBe(90);
  });

  it('valor salvo inválido cai no default da env (igual ao GET) e não loga o conteúdo', async () => {
    const { repository, log, provider } = setup();
    repository.get
      .mockResolvedValueOnce(record({ maxSessionsPerWorker: 80 }))
      .mockResolvedValueOnce(record({ maxSessionsPerWorker: 'segredo-123' }))
      .mockResolvedValueOnce(record({ campoEstranho: 1 }))
      .mockResolvedValueOnce(record({ maxSessionsPerWorker: 70 }))
      .mockResolvedValueOnce(record({ maxSessionsPerWorker: 0 }));
    await provider.refresh();
    await provider.refresh();
    expect(provider.current().value.maxSessionsPerWorker).toBe(40);
    expect(provider.current().origin.maxSessionsPerWorker).toBe('default');
    await provider.refresh();
    expect(provider.current().value.maxSessionsPerWorker).toBe(40);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('segredo-123');
    await provider.refresh();
    expect(provider.current().value.maxSessionsPerWorker).toBe(70);
    await provider.refresh();
    expect(provider.current().value.maxSessionsPerWorker).toBe(40);
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it('refresh durante leitura em curso encadeia nova leitura e termina com o valor novo', async () => {
    const { repository, provider } = setup();
    let releaseFirst!: (v: WorkerScalingSettingsRecord) => void;
    repository.get
      .mockReturnValueOnce(new Promise<WorkerScalingSettingsRecord>((r) => { releaseFirst = r; }))
      .mockResolvedValueOnce(record({ maxSessionsPerWorker: 99 }));
    const first = provider.refresh();
    const second = provider.refresh();
    const third = provider.refresh();
    expect(third).toBe(second);
    releaseFirst(record({ maxSessionsPerWorker: 80 }));
    await second;
    expect(provider.current().value.maxSessionsPerWorker).toBe(99);
    await first;
    expect(repository.get).toHaveBeenCalledTimes(2);
  });

  it('refresh logo após o fim da leitura não abre leitura paralela à encadeada', async () => {
    const { repository, provider } = setup();
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    repository.get.mockImplementation(() => {
      active++;
      maxActive = Math.max(maxActive, active);
      return new Promise<null>((r) => releases.push(() => { active--; r(null); }));
    });
    const calls = [provider.refresh(), provider.refresh()];
    releases.shift()!();
    for (let i = 0; i < 10; i++) {
      calls.push(provider.refresh());
      await Promise.resolve();
    }
    while (releases.length) {
      releases.shift()!();
      await vi.advanceTimersByTimeAsync(0);
    }
    await Promise.all(calls);
    expect(maxActive).toBe(1);
  });

  it('leitura pendurada estoura em 5 s: mantém o último valor bom, warn uma vez, libera o refresh', async () => {
    const { repository, log, provider } = setup();
    repository.get
      .mockResolvedValueOnce(record({ maxSessionsPerWorker: 80 }))
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce(record({ maxSessionsPerWorker: 90 }));
    await provider.refresh();
    const hung = provider.refresh();
    await vi.advanceTimersByTimeAsync(4_999);
    let done = false;
    void hung.then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(hung).resolves.toBeUndefined();
    expect(provider.current().value.maxSessionsPerWorker).toBe(80);
    const again = provider.refresh();
    await vi.advanceTimersByTimeAsync(5_000);
    await again;
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toEqual({ err: 'TimeoutError' });
    await provider.refresh();
    expect(provider.current().value.maxSessionsPerWorker).toBe(90);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leitura rápida limpa o timer do teto', async () => {
    const { repository, provider } = setup(undefined, 1000);
    repository.get.mockResolvedValue(null);
    await provider.refresh();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('start agenda refresh periódico; duas vezes não duplica; stop cancela', async () => {
    const { repository, provider } = setup(1000);
    repository.get.mockResolvedValue(null);
    provider.start();
    provider.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(repository.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(repository.get).toHaveBeenCalledTimes(2);
    provider.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(repository.get).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('intervalo padrão de 30 s', async () => {
    const { repository, provider } = setup();
    repository.get.mockResolvedValue(null);
    provider.start();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(repository.get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(repository.get).toHaveBeenCalledTimes(1);
    provider.stop();
  });
});
