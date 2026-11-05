import { Job, Queue, QueueEvents, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { AppError } from '../../../../../shared/errors/AppError';
import {
  EngineNotReadyError,
  EngineTemporarilyUnavailableError,
} from '../../../../../shared/errors/internal/MessagingErrors';
import { logger } from '../../../../../shared/logger/logger';
import { decodeEngineCall, decodeEngineValue, encodeEngineCall, encodeEngineValue } from '../engineCallCodec';
import { engineCallKind, type EngineCallResult, type QueuedEngineCall } from '../engineCallPlan';
import { fromWireError, toWireError, type WireError } from '../engineErrorWire';
import {
  SESSION_OPEN_TARGET,
  type EngineCommandTarget,
  type IEngineCallHandler,
  type IEngineCommandProducer,
} from '../ports';

/** Fila compartilhada de abertura de socket sem dono vivo (WROLE-08): qualquer worker consome, o lease decide. */
export const SESSION_OPEN_QUEUE = 'session-open';
/** Fila do worker dono (D2: uma por worker, não por sessão). */
export const ENGINE_COMMAND_QUEUE_PREFIX = 'engine-cmd-';
/** Conservador (poucos envios simultâneos por fila); a composição (T18) passa o valor do env. */
export const DEFAULT_ENGINE_COMMAND_CONCURRENCY = 2;

const JOB_NAME = 'engine-call';
/** Estados em que o job ainda não começou: no timeout é removido para o envio não sair depois. */
const NOT_STARTED = new Set(['waiting', 'delayed', 'prioritized', 'waiting-children']);

export function engineCommandQueueName(target: EngineCommandTarget): string {
  if (target === SESSION_OPEN_TARGET) return SESSION_OPEN_QUEUE;
  if (!target || target.includes(':')) throw new TypeError(`workerId inválido para fila: "${target}"`);
  return `${ENGINE_COMMAND_QUEUE_PREFIX}${target}`;
}

interface CommandJobData {
  /** `encodeEngineCall`. */
  call: string;
  /** Epoch ms: depois disso o consumidor não executa (quem chamou já recebeu `ENGINE_NOT_READY`). */
  deadline: number;
}

/** Resultado como envelope (o job nunca falha por erro de negócio): erro tipado atravessa inteiro (WROLE-10). */
type CommandEnvelope = { ok: true; value: string } | { ok: false; error: WireError };

export interface BullEngineCommandQueuesOptions {
  /** `bullConnection()` (compartilhada; não é fechada aqui). BullMQ duplica a conexão bloqueante. */
  connection: Redis;
  /** Prefixo de chaves BullMQ (teste isola por execução). */
  prefix?: string;
  /** Jobs simultâneos por fila consumida. */
  concurrency?: number;
}

interface ProducerChannel {
  queue: Queue<CommandJobData, string>;
  events: QueueEvents;
  ready: Promise<void>;
}

/**
 * Transporte BullMQ dos comandos duráveis da engine (WROLE-06/08). Produtor (`http`): `send` põe o job na fila
 * do dono ou em `session-open` e espera o resultado; `attempts: 1` (D11, sem retry de envio). Consumidor
 * (`worker`): `startConsumers` nas duas filas; `close()` espera os jobs ativos.
 */
export class BullEngineCommandQueues implements IEngineCommandProducer {
  private readonly channels = new Map<string, ProducerChannel>();
  private readonly workers: Worker<CommandJobData, string>[] = [];
  private closed = false;

  constructor(private readonly options: BullEngineCommandQueuesOptions) {}

  async send<C extends QueuedEngineCall>(
    target: EngineCommandTarget,
    call: C,
    timeoutMs: number,
  ): Promise<EngineCallResult<C['method']>> {
    if (this.closed) throw new EngineNotReadyError();
    const channel = this.channel(engineCommandQueueName(target));
    await channel.ready;

    const data: CommandJobData = { call: encodeEngineCall(call), deadline: Date.now() + timeoutMs };
    const job = await channel.queue.add(JOB_NAME, data, {
      attempts: 1,
      removeOnComplete: { age: 300, count: 1000 },
      removeOnFail: { age: 3600, count: 1000 },
    });

    let raw: unknown;
    try {
      raw = await job.waitUntilFinished(channel.events, timeoutMs);
    } catch (err) {
      throw await this.onWaitFailure(job, err);
    }
    return this.unwrap(raw) as EngineCallResult<C['method']>;
  }

  /** Worker: consome a própria fila e `session-open`. Uma vez por instância. */
  startConsumers(workerId: string, handler: IEngineCallHandler): void {
    if (this.closed) throw new Error('BullEngineCommandQueues fechado');
    if (this.workers.length) throw new Error('consumidores já iniciados');
    const concurrency = this.options.concurrency ?? DEFAULT_ENGINE_COMMAND_CONCURRENCY;
    for (const name of [engineCommandQueueName(workerId), SESSION_OPEN_QUEUE]) {
      const worker = new Worker<CommandJobData, string>(
        name,
        (job) => this.process(name, job, handler),
        { connection: this.options.connection, prefix: this.options.prefix, concurrency },
      );
      worker.on('error', (err) => logger.warn({ err, queue: name }, 'Fila de comando da engine: erro do consumidor'));
      this.workers.push(worker);
    }
  }

  /** Consumidores primeiro (esperam jobs ativos), depois produtores. Idempotente. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const workers = this.workers.splice(0);
    await Promise.allSettled(workers.map((w) => w.close()));
    const channels = [...this.channels.values()];
    this.channels.clear();
    await Promise.allSettled(channels.flatMap((c) => [c.events.close(), c.queue.close()]));
  }

  private channel(name: string): ProducerChannel {
    const existing = this.channels.get(name);
    if (existing) return existing;
    const { connection, prefix } = this.options;
    const queue = new Queue<CommandJobData, string>(name, { connection, prefix });
    const events = new QueueEvents(name, { connection, prefix });
    queue.on('error', (err) => logger.warn({ err, queue: name }, 'Fila de comando da engine: erro do produtor'));
    events.on('error', (err) => logger.warn({ err, queue: name }, 'Fila de comando da engine: erro de eventos'));
    const ready = Promise.all([queue.waitUntilReady(), events.waitUntilReady()]).then(() => undefined);
    ready.catch(() => this.channels.delete(name));
    const channel = { queue, events, ready };
    this.channels.set(name, channel);
    return channel;
  }

  /** Timeout ou fila fechando: job não iniciado sai da fila; nunca devolve erro cru. */
  private async onWaitFailure(job: Job<CommandJobData, string>, err: unknown): Promise<AppError> {
    let state: string;
    try {
      state = await job.getState();
    } catch {
      state = 'unknown';
    }
    if (state === 'failed') {
      logger.warn({ err, jobId: job.id, queue: job.queueName }, 'Comando da engine falhou no consumidor');
      return new EngineTemporarilyUnavailableError();
    }
    if (NOT_STARTED.has(state)) {
      try {
        await job.remove();
      } catch (removeErr) {
        // Pego por um consumidor entre a leitura e a remoção: o `deadline` impede a execução.
        logger.warn({ err: removeErr, jobId: job.id }, 'Comando da engine: não removido após timeout');
      }
    }
    return new EngineNotReadyError();
  }

  private unwrap(raw: unknown): unknown {
    let envelope: CommandEnvelope;
    try {
      envelope = JSON.parse(String(raw)) as CommandEnvelope;
    } catch {
      throw new EngineTemporarilyUnavailableError();
    }
    if (envelope?.ok === true && typeof envelope.value === 'string') return decodeEngineValue(envelope.value);
    if (envelope?.ok === false) throw fromWireError(envelope.error);
    throw new EngineTemporarilyUnavailableError();
  }

  private async process(queueName: string, job: Job<CommandJobData, string>, handler: IEngineCallHandler): Promise<string> {
    const reply = (envelope: CommandEnvelope) => JSON.stringify(envelope);
    try {
      if (typeof job.data?.deadline === 'number' && Date.now() > job.data.deadline) {
        return reply({ ok: false, error: toWireError(new EngineNotReadyError()) });
      }
      const call = decodeEngineCall(job.data.call);
      const kind = engineCallKind(call.method);
      const allowed = queueName === SESSION_OPEN_QUEUE ? kind === 'open' : kind === 'command' || kind === 'open';
      if (!allowed) throw new TypeError(`método ${call.method} (${kind}) não pertence à fila ${queueName}`);
      const value = await handler.handle(call);
      return reply({ ok: true, value: encodeEngineValue(value) });
    } catch (err) {
      if (!(err instanceof Error && 'code' in err)) {
        logger.warn({ err, jobId: job.id, queue: queueName }, 'Comando da engine: erro não tipado');
      }
      return reply({ ok: false, error: toWireError(err) });
    }
  }
}
