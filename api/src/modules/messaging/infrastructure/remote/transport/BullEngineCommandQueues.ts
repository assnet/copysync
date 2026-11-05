import { DelayedError, Job, Queue, QueueEvents, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { AppError } from '../../../../../shared/errors/AppError';
import {
  EngineCommandOutcomeUnknownError,
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

/** Vigia do teto (ADOPT-09): mesmo passo do ticker de adoção. */
export const DEFAULT_SESSION_OPEN_CHECK_MS = 5_000;
/** Job pego com o processo cheio volta à fila com este atraso (outro worker o pega). */
const SESSION_OPEN_REQUEUE_MS = 50;

/**
 * Shutdown do worker (WROLE-15): espera os jobs ativos até este teto e então fecha à força, para
 * sobrar tempo a sockets, flush e leases dentro dos 30 s que a Render dá ao processo.
 */
export const ENGINE_COMMAND_CLOSE_TIMEOUT_MS = 20_000;
/** Teto de leitura/remoção do job depois da espera (Redis lento não segura quem chamou). */
const JOB_STATE_READ_MS = 2_000;

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
  /**
   * Teto do processo (ADOPT-09, só com a adoção ligada): `false` pausa o consumo local de
   * `session-open` (a fila fica para outro worker) e `true` retoma. Ausente = consome sempre (E3).
   */
  sessionOpenHasCapacity?: () => boolean;
  /** Intervalo do vigia do teto (teste encurta). */
  sessionOpenCheckMs?: number;
  /** Teto da espera dos jobs ativos no `close()` (padrão `ENGINE_COMMAND_CLOSE_TIMEOUT_MS`; teste encurta). */
  closeTimeoutMs?: number;
  /** `lockDuration`/`stalledInterval` do BullMQ nos consumidores (só teste encurta; padrão da lib). */
  lockDurationMs?: number;
  stalledIntervalMs?: number;
}

const TIMED_OUT: unique symbol = Symbol('timed-out');

/** `TIMED_OUT` se `promise` não assentar em `ms`; a rejeição dela atravessa. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), Math.max(ms, 0));
    timer.unref?.();
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

/** Espera interrompida pelo `close()` (shutdown do `http`). */
class WaitAborted extends Error {}

interface ProducerChannel {
  queue: Queue<CommandJobData, string>;
  events: QueueEvents;
  ready: Promise<void>;
}

/**
 * Transporte BullMQ dos comandos duráveis da engine (WROLE-06/08). Produtor (`http`): `send` põe o job na fila
 * do dono ou em `session-open` e espera o resultado; `attempts: 1` (D11, sem retry de envio). Consumidor
 * (`worker`): `startConsumers` nas duas filas; `close()` espera os jobs ativos até o teto. Job que já começou
 * quando a espera acaba devolve `ENGINE_COMMAND_OUTCOME_UNKNOWN` (nunca reexecuta: `maxStalledCount: 0`). Com `sessionOpenHasCapacity`
 * (ADOPT-09) um vigia pausa `session-open` com o processo cheio; job pego mesmo assim volta à fila.
 */
export class BullEngineCommandQueues implements IEngineCommandProducer {
  private readonly channels = new Map<string, ProducerChannel>();
  private readonly workers: Worker<CommandJobData, string>[] = [];
  private sessionOpenWorker: Worker<CommandJobData, string> | undefined;
  private sessionOpenPaused = true;
  private sessionOpenStarted = false;
  private capacityTimer: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  /** Produtor: esperas em curso; o `close()` interrompe cada uma e aguarda a resposta tipada. */
  private readonly waits = new Set<{ abort: () => void; settled: Promise<unknown> }>();
  /** Consumidor: jobs em execução neste processo (o `close()` espera até o teto). */
  private readonly running = new Set<Promise<unknown>>();

  constructor(private readonly options: BullEngineCommandQueuesOptions) {}

  async send<C extends QueuedEngineCall>(
    target: EngineCommandTarget,
    call: C,
    timeoutMs: number,
  ): Promise<EngineCallResult<C['method']>> {
    if (this.closed) throw new EngineNotReadyError();
    const name = engineCommandQueueName(target);
    const deadline = Date.now() + timeoutMs;
    const channel = this.channel(name);
    const data: CommandJobData = { call: encodeEngineCall(call), deadline };

    // Conexão e `add` contam no prazo: Redis fora não segura quem chamou além do `timeoutMs`.
    const adding = channel.ready.then(() =>
      channel.queue.add(JOB_NAME, data, {
        attempts: 1,
        removeOnComplete: { age: 300, count: 1000 },
        removeOnFail: { age: 3600, count: 1000 },
      }),
    );
    let added: Job<CommandJobData, string> | typeof TIMED_OUT;
    try {
      added = await within(adding, timeoutMs);
    } catch (err) {
      logger.warn({ err, queue: name }, 'Comando da engine: falha ao enfileirar');
      throw new EngineNotReadyError();
    }
    if (added === TIMED_OUT) {
      // Entrou depois do prazo: sai da fila (o `deadline` já impede a execução se a remoção falhar).
      // Canal ainda conectando fica no mapa: o próximo envio reusa a mesma conexão (Redis fora não acumula canais).
      adding.then((late) => late.remove()).catch(() => undefined);
      throw new EngineNotReadyError();
    }
    const job = added;

    let abort!: () => void;
    const aborted = new Promise<never>((_, reject) => { abort = () => reject(new WaitAborted()); });
    aborted.catch(() => undefined);
    const outcome = (async () => {
      try {
        const raw = await Promise.race([
          job.waitUntilFinished(channel.events, Math.max(deadline - Date.now(), 1)),
          aborted,
        ]);
        return { raw };
      } catch (err) {
        return { error: await this.onWaitFailure(job, err) };
      }
    })();
    const wait = { abort, settled: outcome };
    this.waits.add(wait);
    // `close()` chegou durante o `add`: não espera o prazo inteiro.
    if (this.closed) abort();
    const result = await outcome.finally(() => this.waits.delete(wait));
    if ('error' in result) throw result.error;
    return this.unwrap(result.raw) as EngineCallResult<C['method']>;
  }

  /** Worker: consome a própria fila e `session-open`. Uma vez por instância. */
  startConsumers(workerId: string, handler: IEngineCallHandler): void {
    if (this.closed) throw new Error('BullEngineCommandQueues fechado');
    if (this.workers.length) throw new Error('consumidores já iniciados');
    const concurrency = this.options.concurrency ?? DEFAULT_ENGINE_COMMAND_CONCURRENCY;
    const gated = this.options.sessionOpenHasCapacity;
    for (const name of [engineCommandQueueName(workerId), SESSION_OPEN_QUEUE]) {
      const isOpen = name === SESSION_OPEN_QUEUE;
      const worker = new Worker<CommandJobData, string>(
        name,
        (job, token) => this.track(this.process(name, job, handler, token)),
        {
          connection: this.options.connection,
          prefix: this.options.prefix,
          concurrency,
          // Job travado (processo caiu no meio) vira falha: nunca reexecuta um envio (D11).
          maxStalledCount: 0,
          ...(this.options.lockDurationMs !== undefined && { lockDuration: this.options.lockDurationMs }),
          ...(this.options.stalledIntervalMs !== undefined && { stalledInterval: this.options.stalledIntervalMs }),
          // Com teto, `session-open` só começa a consumir depois da 1ª checagem de vaga.
          autorun: !(isOpen && gated),
        },
      );
      worker.on('error', (err) => logger.warn({ err, queue: name }, 'Fila de comando da engine: erro do consumidor'));
      this.workers.push(worker);
      if (isOpen) this.sessionOpenWorker = worker;
    }
    if (gated) {
      void this.syncSessionOpen();
      this.capacityTimer = setInterval(
        () => void this.syncSessionOpen(),
        this.options.sessionOpenCheckMs ?? DEFAULT_SESSION_OPEN_CHECK_MS,
      );
      this.capacityTimer.unref?.();
    }
  }

  /** Pausa/retoma o consumo local de `session-open` conforme a vaga (ADOPT-09). Nunca lança. */
  private async syncSessionOpen(): Promise<void> {
    const worker = this.sessionOpenWorker;
    const hasCapacity = this.options.sessionOpenHasCapacity;
    if (!worker || !hasCapacity || this.closed) return;
    let full: boolean;
    try {
      full = !hasCapacity();
    } catch (err) {
      logger.warn({ err }, 'Fila session-open: falha ao ler a vaga do processo');
      return;
    }
    try {
      if (full && !this.sessionOpenPaused) {
        this.sessionOpenPaused = true;
        // Sem esperar os jobs ativos: o que já começou termina no gate (503 na corrida, como hoje).
        await worker.pause(true);
        logger.info({ queue: SESSION_OPEN_QUEUE }, 'Processo cheio: consumo local de session-open pausado');
      } else if (!full && this.sessionOpenPaused) {
        this.sessionOpenPaused = false;
        if (!this.sessionOpenStarted) {
          this.sessionOpenStarted = true;
          worker.run().catch((err) => logger.warn({ err, queue: SESSION_OPEN_QUEUE }, 'Fila session-open: consumidor parou'));
        } else {
          await worker.resume();
          logger.info({ queue: SESSION_OPEN_QUEUE }, 'Vaga liberada: consumo local de session-open retomado');
        }
      }
    } catch (err) {
      logger.warn({ err, queue: SESSION_OPEN_QUEUE }, 'Fila session-open: falha ao pausar/retomar');
    }
  }

  /**
   * Shutdown. Produtor: interrompe as esperas (cada uma devolve erro tipado, `OUTCOME_UNKNOWN` se o
   * job já começou). Consumidor: para de pegar jobs, espera os ativos até `closeTimeoutMs` e fecha à
   * força (job que segue rodando perde o lock e vira falha, sem reexecutar). Idempotente.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.capacityTimer) clearInterval(this.capacityTimer);
    this.capacityTimer = undefined;
    this.sessionOpenWorker = undefined;
    const cap = this.options.closeTimeoutMs ?? ENGINE_COMMAND_CLOSE_TIMEOUT_MS;

    const waits = [...this.waits];
    for (const w of waits) w.abort();

    const workers = this.workers.splice(0);
    await Promise.allSettled(workers.map((w) => w.pause(true)));
    const drained = await within(Promise.allSettled([...this.running, ...waits.map((w) => w.settled)]), cap);
    if (drained === TIMED_OUT) {
      logger.warn({ running: this.running.size, capMs: cap }, 'Fila de comando da engine: teto do fechamento, fechando à força');
    }
    await Promise.allSettled(workers.map((w) => w.close(true)));

    const channels = [...this.channels.entries()];
    this.channels.clear();
    // Com teto: `QueueEvents.close()` espera a conexão ficar pronta (Redis fora o seguraria para sempre).
    await within(Promise.allSettled(channels.map(([name, c]) => this.dropChannel(name, c))), JOB_STATE_READ_MS);
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.running.add(promise);
    const done = () => this.running.delete(promise);
    promise.then(done, done);
    return promise;
  }

  private channel(name: string): ProducerChannel {
    const existing = this.channels.get(name);
    if (existing) return existing;
    const { connection, prefix } = this.options;
    const queue = new Queue<CommandJobData, string>(name, { connection, prefix });
    const events = new QueueEvents(name, { connection, prefix });
    queue.on('error', (err) => logger.warn({ err, queue: name }, 'Fila de comando da engine: erro do produtor'));
    events.on('error', (err) => logger.warn({ err, queue: name }, 'Fila de comando da engine: erro de eventos'));
    const channel: ProducerChannel = {
      queue,
      events,
      ready: Promise.all([queue.waitUntilReady(), events.waitUntilReady()]).then(() => undefined),
    };
    // Canal que falhou é fechado antes de sair do mapa (sem conexão de eventos órfã).
    channel.ready.catch(() => this.dropChannel(name, channel));
    this.channels.set(name, channel);
    return channel;
  }

  /** Tira do mapa (se ainda for o atual) e fecha. Nunca lança. */
  private async dropChannel(name: string, channel: ProducerChannel): Promise<void> {
    if (this.channels.get(name) === channel) this.channels.delete(name);
    await Promise.allSettled([channel.events.close(), channel.queue.close()]);
  }

  /**
   * Prazo, shutdown ou falha do job: nunca devolve erro cru. Só job que não começou e saiu da fila (ou
   * que o `deadline` impede) é `ENGINE_NOT_READY`; o resto pode ter enviado → `OUTCOME_UNKNOWN`.
   */
  private async onWaitFailure(job: Job<CommandJobData, string>, err: unknown): Promise<AppError> {
    let state: string;
    try {
      const read = await within(job.getState(), JOB_STATE_READ_MS);
      state = read === TIMED_OUT ? 'unknown' : read;
    } catch {
      state = 'unknown';
    }
    if (NOT_STARTED.has(state)) {
      try {
        if ((await within(job.remove(), JOB_STATE_READ_MS)) !== TIMED_OUT) return new EngineNotReadyError();
      } catch (removeErr) {
        logger.warn({ err: removeErr, jobId: job.id }, 'Comando da engine: não removido após a espera');
      }
      // Não removido (pego por um consumidor no meio): passado o `deadline` ele não executa.
      if (Date.now() > job.data.deadline) return new EngineNotReadyError();
    } else if (state === 'failed') {
      // O consumidor nunca falha por erro de negócio (envelope): falha = job travado depois de começar.
      logger.warn({ err, jobId: job.id, queue: job.queueName }, 'Comando da engine falhou no consumidor');
    } else if (!(err instanceof WaitAborted)) {
      logger.warn({ jobId: job.id, queue: job.queueName, state }, 'Comando da engine: prazo vencido com o job iniciado');
    }
    return new EngineCommandOutcomeUnknownError();
  }

  private isSessionOpenFull(): boolean {
    const hasCapacity = this.options.sessionOpenHasCapacity;
    if (!hasCapacity) return false;
    try {
      return !hasCapacity();
    } catch {
      return false;
    }
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

  private async process(
    queueName: string,
    job: Job<CommandJobData, string>,
    handler: IEngineCallHandler,
    token?: string,
  ): Promise<string> {
    const reply = (envelope: CommandEnvelope) => JSON.stringify(envelope);
    if (queueName === SESSION_OPEN_QUEUE && token && this.isSessionOpenFull()) {
      // Pego numa espera bloqueante iniciada antes da pausa: devolve à fila para outro worker.
      await job.moveToDelayed(Date.now() + SESSION_OPEN_REQUEUE_MS, token);
      void this.syncSessionOpen();
      throw new DelayedError();
    }
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
