import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OutboundMediaJob } from '../../application/contracts/IOutboundMediaQueue';
import { InMemoryOutboundMediaQueue } from './InMemoryOutboundMediaQueue';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function job(messageId: string, conversationId = 'c1', sessionId = 's1'): OutboundMediaJob {
  return { messageId, tenantId: 't1', sessionId, conversationId };
}

/** Escoa as promessas pendentes: o despacho começa num microtask, não dentro do `enqueue`. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function makeQueue(opts?: { global?: number; perSession?: number; max?: number }) {
  const started: string[] = [];
  const running = new Map<string, Deferred>();
  const run = vi.fn((j: OutboundMediaJob) => {
    started.push(j.messageId);
    const d = deferred();
    running.set(j.messageId, d);
    return d.promise;
  });
  const logger = { error: vi.fn(), warn: vi.fn() };
  const queue = new InMemoryOutboundMediaQueue({
    run,
    globalConcurrency: opts?.global ?? 2,
    perSessionConcurrency: opts?.perSession ?? 2,
    maxQueuedPerSession: opts?.max ?? 100,
    logger,
  });

  /** Conclui o envio de `id` e deixa a fila reagir. */
  const finish = async (id: string) => {
    running.get(id)!.resolve();
    await flush();
  };
  /** Falha o envio de `id` e deixa a fila reagir. */
  const fail = async (id: string, err: unknown) => {
    running.get(id)!.reject(err);
    await flush();
  };

  return { queue, started, run, logger, finish, fail };
}

describe('InMemoryOutboundMediaQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mesma conversa: um envio por vez, na ordem de chegada', async () => {
    const { queue, started, finish } = makeQueue({ global: 5, perSession: 5 });
    queue.enqueue(job('m1'));
    queue.enqueue(job('m2'));
    queue.enqueue(job('m3'));
    await flush();
    expect(started).toEqual(['m1']);

    await finish('m1');
    expect(started).toEqual(['m1', 'm2']);

    await finish('m2');
    expect(started).toEqual(['m1', 'm2', 'm3']);
  });

  it('conversas diferentes da mesma sessão enviam em paralelo até o limite da sessão', async () => {
    const { queue, started, finish } = makeQueue({ global: 10, perSession: 2 });
    queue.enqueue(job('m1', 'c1'));
    queue.enqueue(job('m2', 'c2'));
    queue.enqueue(job('m3', 'c3'));
    await flush();
    expect(started).toEqual(['m1', 'm2']);

    await finish('m2');
    expect(started).toEqual(['m1', 'm2', 'm3']);
  });

  it('o limite global vale somando todas as sessões', async () => {
    const { queue, started, finish } = makeQueue({ global: 2, perSession: 2 });
    queue.enqueue(job('m1', 'c1', 's1'));
    queue.enqueue(job('m2', 'c2', 's2'));
    queue.enqueue(job('m3', 'c3', 's3'));
    await flush();
    expect(started).toEqual(['m1', 'm2']);

    await finish('m1');
    expect(started).toEqual(['m1', 'm2', 'm3']);
  });

  it('vaga liberada vai para o próximo elegível por ordem de chegada, sem furar a fila da conversa', async () => {
    const { queue, started, finish } = makeQueue({ global: 2, perSession: 2 });
    queue.enqueue(job('m1', 'c1'));
    queue.enqueue(job('m2', 'c1'));
    queue.enqueue(job('m3', 'c2'));
    queue.enqueue(job('m4', 'c3'));
    await flush();
    // m2 espera a própria conversa; m3 ocupa a segunda vaga
    expect(started).toEqual(['m1', 'm3']);

    await finish('m1');
    // m2 chegou antes de m4
    expect(started).toEqual(['m1', 'm3', 'm2']);
  });

  it('teto por sessão: recusa quando pendentes + em envio chegam ao limite', async () => {
    const { queue, finish } = makeQueue({ global: 1, perSession: 1, max: 3 });
    expect(queue.enqueue(job('m1', 'c1'))).toBe(true);
    expect(queue.enqueue(job('m2', 'c2'))).toBe(true);
    expect(queue.enqueue(job('m3', 'c3'))).toBe(true);
    expect(queue.enqueue(job('m4', 'c4'))).toBe(false);

    // Outra sessão tem teto próprio
    expect(queue.enqueue(job('x1', 'c9', 's2'))).toBe(true);

    await flush();
    await finish('m1');
    expect(queue.enqueue(job('m5', 'c5'))).toBe(true);
  });

  it('envio que rejeita é registrado no log e a fila segue', async () => {
    const { queue, started, logger, fail } = makeQueue();
    queue.enqueue(job('m1'));
    queue.enqueue(job('m2'));
    await flush();

    const err = new Error('falha no envio');
    await fail('m1', err);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err, messageId: 'm1', sessionId: 's1' }),
      expect.any(String),
    );
    expect(started).toEqual(['m1', 'm2']);
    expect(queue.inFlightIds()).toEqual(['m2']);
  });

  it('envio que lança de forma síncrona também não trava a fila', async () => {
    const logger = { error: vi.fn(), warn: vi.fn() };
    const run = vi
      .fn<(j: OutboundMediaJob) => Promise<void>>()
      .mockImplementationOnce(() => {
        throw new Error('quebrou antes de começar');
      })
      .mockResolvedValue(undefined);
    const queue = new InMemoryOutboundMediaQueue({
      run,
      globalConcurrency: 2,
      perSessionConcurrency: 2,
      maxQueuedPerSession: 100,
      logger,
    });

    queue.enqueue(job('m1'));
    queue.enqueue(job('m2'));
    await flush();

    expect(run).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(queue.inFlightIds()).toEqual([]);
  });

  it('inFlightIds lista os enfileirados e os em envio, e esquece os concluídos', async () => {
    const { queue, finish } = makeQueue({ global: 1, perSession: 1 });
    queue.enqueue(job('m1', 'c1'));
    queue.enqueue(job('m2', 'c2'));
    await flush();
    expect([...queue.inFlightIds()].sort()).toEqual(['m1', 'm2']);

    await finish('m1');
    expect(queue.inFlightIds()).toEqual(['m2']);

    await finish('m2');
    expect(queue.inFlightIds()).toEqual([]);
  });

  it('drain recusa novos envios e resolve quando os em andamento terminam', async () => {
    const { queue, finish } = makeQueue();
    queue.enqueue(job('m1'));
    await flush();

    let drained = false;
    const draining = queue.drain(25_000).then(() => {
      drained = true;
    });

    expect(queue.enqueue(job('m2', 'c2'))).toBe(false);
    await flush();
    expect(drained).toBe(false);

    await finish('m1');
    await draining;
    expect(drained).toBe(true);
  });

  it('drain descarta o que ainda não começou: fica PENDING para a recuperação', async () => {
    const { queue, run, logger, finish } = makeQueue({ global: 1, perSession: 1 });
    queue.enqueue(job('m1', 'c1'));
    queue.enqueue(job('m2', 'c2'));
    await flush();

    const draining = queue.drain(25_000);
    expect(queue.inFlightIds()).toEqual(['m1']);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    await finish('m1');
    await draining;
    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.inFlightIds()).toEqual([]);
  });

  it('drain respeita o prazo com envio preso e resolve sem lançar', async () => {
    const { queue } = makeQueue();
    queue.enqueue(job('m1'));
    await flush();

    let drained = false;
    const draining = queue.drain(25_000).then(() => {
      drained = true;
    });

    await vi.advanceTimersByTimeAsync(24_999);
    expect(drained).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(draining).resolves.toBeUndefined();
    expect(drained).toBe(true);
  });

  it('drain sem nada em andamento resolve na hora', async () => {
    const { queue } = makeQueue();
    await expect(queue.drain(25_000)).resolves.toBeUndefined();
    expect(queue.enqueue(job('m1'))).toBe(false);
  });
});
