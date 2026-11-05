import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { SessionNotFoundError } from '../../../../../shared/errors/internal/SessionErrors';
import {
  EngineCommandOutcomeUnknownError,
  EngineNotReadyError,
} from '../../../../../shared/errors/internal/MessagingErrors';
import { engineCall } from '../engineCallPlan';
import { SESSION_OPEN_TARGET, type IEngineCallHandler } from '../ports';
import {
  BullEngineCommandQueues,
  engineCommandQueueName,
  type BullEngineCommandQueuesOptions,
} from './BullEngineCommandQueues';

/**
 * Redis LOCAL descartável (`scripts/redis-descartavel.sh start`): INTEGRATION_REDIS_URL=redis://127.0.0.1:<porta>.
 * Sem a variável o arquivo é pulado; host fora de localhost é recusado.
 */
const url = process.env['INTEGRATION_REDIS_URL'];
if (url) {
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`INTEGRATION_REDIS_URL precisa apontar para localhost (recebido: ${host}).`);
  }
}

const prefix = `int-cmd-${Date.now()}`;
const connections: Redis[] = [];
const opened: BullEngineCommandQueues[] = [];

function queues(extra: Partial<BullEngineCommandQueuesOptions> = {}): BullEngineCommandQueues {
  const connection = new Redis(url!, { maxRetriesPerRequest: null });
  connections.push(connection);
  const q = new BullEngineCommandQueues({ connection, prefix, ...extra });
  opened.push(q);
  return q;
}

const send = engineCall('sendTextMessage', { sessionId: 's1', tenantId: 't1', to: '5511999999999', body: 'oi' });
const connect = engineCall('connectSession', { sessionId: 's1', tenantId: 't1' });

afterEach(async () => {
  await Promise.all(opened.splice(0).map((q) => q.close()));
});
afterAll(async () => {
  await Promise.all(connections.map((c) => c.quit()));
});

describe.skipIf(!url)('BullEngineCommandQueues com Redis real', () => {
  it('resultado do dono volta ao produtor', async () => {
    const worker = queues();
    const handler: IEngineCallHandler = { handle: vi.fn(async () => ({ messageId: 'm1', at: new Date(0) })) };
    worker.startConsumers('w1', handler);

    const result = await queues().send('w1', send, 5000);
    expect(result).toEqual({ messageId: 'm1', at: new Date(0) });
    expect(handler.handle).toHaveBeenCalledWith(send);
  });

  it('erro tipado volta como a mesma classe interna', async () => {
    const worker = queues();
    worker.startConsumers('w1', { handle: async () => { throw new SessionNotFoundError('s1'); } });

    const err = await queues().send('w1', send, 5000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionNotFoundError);
    expect(err).toMatchObject({ code: 'SESSION_NOT_FOUND', message: 'Session not found: s1', statusCode: 404 });
  });

  it('timeout sem consumidor: ENGINE_NOT_READY e o job em espera sai da fila', async () => {
    const err = await queues().send('w-ausente', send, 300).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineNotReadyError);

    const connection = new Redis(url!, { maxRetriesPerRequest: null });
    connections.push(connection);
    const inspect = new Queue(engineCommandQueueName('w-ausente'), { connection, prefix });
    expect(await inspect.getJobCounts('waiting', 'active', 'delayed', 'prioritized')).toEqual({
      waiting: 0, active: 0, delayed: 0, prioritized: 0,
    });

    // Um consumidor que suba depois não executa o envio.
    const late = queues();
    const handle = vi.fn(async () => ({ messageId: 'tarde' }));
    late.startConsumers('w-ausente', { handle });
    await new Promise((r) => setTimeout(r, 300));
    expect(handle).not.toHaveBeenCalled();
    await inspect.close();
  });

  it('session-open é consumido por exatamente 1 de 2 workers', async () => {
    const a = vi.fn(async () => ({ status: 'CONNECTING' }));
    const b = vi.fn(async () => ({ status: 'CONNECTING' }));
    queues().startConsumers('wa', { handle: a });
    queues().startConsumers('wb', { handle: b });

    await expect(queues().send(SESSION_OPEN_TARGET, connect, 5000)).resolves.toEqual({ status: 'CONNECTING' });
    await new Promise((r) => setTimeout(r, 200));
    expect(a.mock.calls.length + b.mock.calls.length).toBe(1);
  });

  it('session-open recusa método de comando (não executa)', async () => {
    const handle = vi.fn(async () => undefined);
    queues().startConsumers('wc', { handle });
    // `send` para 'open' com método `command` não tipa; força pelo cast para provar a guarda do consumidor.
    const err = await queues()
      .send(SESSION_OPEN_TARGET, send as unknown as typeof connect, 5000)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'ENGINE_TEMPORARILY_UNAVAILABLE' });
    expect(handle).not.toHaveBeenCalled();
  });

  it('close() espera o job ativo terminar', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let finished = false;
    const worker = queues();
    worker.startConsumers('wd', { handle: async () => { await gate; finished = true; return { messageId: 'm2' }; } });
    const pending = queues().send('wd', send, 5000);
    await vi.waitFor(async () => {
      const c = new Queue(engineCommandQueueName('wd'), { connection: connections[0]!, prefix });
      const counts = await c.getJobCounts('active');
      await c.close();
      expect(counts.active).toBe(1);
    }, { timeout: 3000 });

    const closing = worker.close();
    setTimeout(release, 100);
    await closing;
    expect(finished).toBe(true);
    await expect(pending).resolves.toEqual({ messageId: 'm2' });
  });

  describe('teto do processo em session-open (ADOPT-09)', () => {
    const openCall = (i: number) => engineCall('connectSession', { sessionId: `s${i}`, tenantId: 't1' });
    const counter = () => {
      const seen: string[] = [];
      const handler: IEngineCallHandler = {
        handle: vi.fn(async (c) => { seen.push((c.args[0] as { sessionId: string }).sessionId); return { status: 'CONNECTING' }; }),
      };
      return { seen, handler };
    };

    it('2 consumidores, um cheio: todos os jobs vão ao outro', async () => {
      const full = counter();
      const free = counter();
      queues({ sessionOpenHasCapacity: () => false, sessionOpenCheckMs: 50 }).startConsumers('cap-full', full.handler);
      queues({ sessionOpenHasCapacity: () => true, sessionOpenCheckMs: 50 }).startConsumers('cap-free', free.handler);

      const producer = queues();
      await Promise.all([1, 2, 3, 4, 5, 6].map((i) => producer.send(SESSION_OPEN_TARGET, openCall(i), 5000)));
      expect(full.seen).toEqual([]);
      expect(free.seen.sort()).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    });

    it('cheio depois de consumir: pausa e os jobs seguintes vão ao outro', async () => {
      let capacity = true;
      const a = counter();
      const b = counter();
      queues({ sessionOpenHasCapacity: () => capacity, sessionOpenCheckMs: 50 }).startConsumers('cap-a', a.handler);
      const producer = queues();
      await producer.send(SESSION_OPEN_TARGET, openCall(1), 5000);
      expect(a.seen).toEqual(['s1']);

      capacity = false;
      await new Promise((r) => setTimeout(r, 200));
      queues({ sessionOpenHasCapacity: () => true, sessionOpenCheckMs: 50 }).startConsumers('cap-b', b.handler);
      await Promise.all([2, 3, 4].map((i) => producer.send(SESSION_OPEN_TARGET, openCall(i), 5000)));
      expect(a.seen).toEqual(['s1']);
      expect(b.seen.sort()).toEqual(['s2', 's3', 's4']);
    });

    it('retoma ao liberar vaga', async () => {
      let capacity = false;
      const w = counter();
      queues({ sessionOpenHasCapacity: () => capacity, sessionOpenCheckMs: 50 }).startConsumers('cap-r', w.handler);

      const pending = queues().send(SESSION_OPEN_TARGET, openCall(9), 5000);
      await new Promise((r) => setTimeout(r, 300));
      expect(w.seen).toEqual([]);

      capacity = true;
      await expect(pending).resolves.toEqual({ status: 'CONNECTING' });
      expect(w.seen).toEqual(['s9']);
    });
  });

  describe('resultado desconhecido, sem reexecução, prazo e teto (T22)', () => {
    const activeCount = async (workerId: string) => {
      const c = new Queue(engineCommandQueueName(workerId), { connection: connections[0]!, prefix });
      const counts = await c.getJobCounts('active', 'waiting', 'failed', 'completed');
      await c.close();
      return counts;
    };

    it('job ativo no prazo: OUTCOME_UNKNOWN e o envio sai uma vez só', async () => {
      const handle = vi.fn(async () => { await new Promise((r) => setTimeout(r, 600)); return { messageId: 'm1' }; });
      queues().startConsumers('wu', { handle });
      const err = await queues().send('wu', send, 250).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EngineCommandOutcomeUnknownError);
      expect(err).toMatchObject({ code: 'ENGINE_COMMAND_OUTCOME_UNKNOWN', statusCode: 504 });
      await vi.waitFor(async () => expect((await activeCount('wu')).completed).toBe(1), { timeout: 3000 });
      expect(handle).toHaveBeenCalledTimes(1);
    });

    it('job travado (consumidor morreu no meio) não reexecuta: vira falha e OUTCOME_UNKNOWN', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const short = { lockDurationMs: 400, stalledIntervalMs: 200, closeTimeoutMs: 50 };
      const first = vi.fn(async () => { await gate; return { messageId: 'a' }; });
      const dying = queues(short);
      dying.startConsumers('ws', { handle: first });
      const pending = queues().send('ws', send, 8000).catch((e: unknown) => e);
      await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1), { timeout: 3000 });

      await dying.close(); // teto curto: fecha à força com o job ainda rodando (lock deixa de ser renovado)
      const second = vi.fn(async () => ({ messageId: 'b' }));
      queues(short).startConsumers('ws', { handle: second });

      expect(await pending).toBeInstanceOf(EngineCommandOutcomeUnknownError);
      expect(second).not.toHaveBeenCalled();
      expect((await activeCount('ws')).failed).toBe(1);
      release();
    });

    it('Redis fora: ENGINE_NOT_READY no prazo, sem acumular canal, close() com teto', async () => {
      const dead = new Redis('redis://127.0.0.1:1', { maxRetriesPerRequest: null, retryStrategy: () => 200 });
      dead.on('error', () => undefined);
      const q = new BullEngineCommandQueues({ connection: dead, prefix });
      for (let i = 0; i < 3; i++) {
        const started = Date.now();
        const err = await q.send('w-dead', send, 300).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(EngineNotReadyError);
        expect(Date.now() - started).toBeLessThan(1500);
      }
      expect((q as unknown as { channels: Map<string, unknown> }).channels.size).toBe(1);
      const closing = Date.now();
      await q.close();
      expect(Date.now() - closing).toBeLessThan(3500);
      dead.disconnect();
    });

    it('close() do consumidor respeita o teto e fecha à força', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const worker = queues({ closeTimeoutMs: 200 });
      const handle = vi.fn(async () => { await gate; return { messageId: 'x' }; });
      worker.startConsumers('wt', { handle });
      void queues().send('wt', send, 5000).catch(() => undefined);
      await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1), { timeout: 3000 });

      const started = Date.now();
      await worker.close();
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(150);
      expect(elapsed).toBeLessThan(2000);
      release();
    });

    it('shutdown do http com espera pendente: job ativo vira OUTCOME_UNKNOWN; job em espera, NOT_READY e sai', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const handle = vi.fn(async () => { await gate; return { messageId: 'y' }; });
      queues().startConsumers('wh', { handle });
      const http = queues();
      const active = http.send('wh', send, 10_000).catch((e: unknown) => e);
      const idle = http.send('w-ninguem', send, 10_000).catch((e: unknown) => e);
      await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1), { timeout: 3000 });
      await new Promise((r) => setTimeout(r, 100));

      const started = Date.now();
      await http.close();
      expect(Date.now() - started).toBeLessThan(3000);
      expect(await active).toBeInstanceOf(EngineCommandOutcomeUnknownError);
      expect(await idle).toBeInstanceOf(EngineNotReadyError);
      expect((await activeCount('w-ninguem')).waiting).toBe(0);
      release();
      await vi.waitFor(async () => expect((await activeCount('wh')).completed).toBe(1), { timeout: 3000 });
      expect(handle).toHaveBeenCalledTimes(1);
    });
  });
});
