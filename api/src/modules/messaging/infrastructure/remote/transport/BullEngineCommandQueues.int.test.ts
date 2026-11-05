import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { SessionNotFoundError } from '../../../../../shared/errors/internal/SessionErrors';
import { EngineNotReadyError } from '../../../../../shared/errors/internal/MessagingErrors';
import { engineCall } from '../engineCallPlan';
import { SESSION_OPEN_TARGET, type IEngineCallHandler } from '../ports';
import { BullEngineCommandQueues, engineCommandQueueName } from './BullEngineCommandQueues';

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

function queues(): BullEngineCommandQueues {
  const connection = new Redis(url!, { maxRetriesPerRequest: null });
  connections.push(connection);
  const q = new BullEngineCommandQueues({ connection, prefix });
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
});
