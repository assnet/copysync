import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { AppError } from '../../../../../shared/errors/AppError';
import { EngineNotReadyError } from '../../../../../shared/errors/internal/MessagingErrors';
import { logger } from '../../../../../shared/logger/logger';
import { decodeEngineCall, decodeEngineValue, encodeEngineCall, encodeEngineValue } from '../engineCallCodec';
import { engineCallKind, type EngineCall, type EngineCallResult, type RpcEngineCall } from '../engineCallPlan';
import { fromWireError, toWireError, type WireError } from '../engineErrorWire';
import type { IEngineCallHandler, IEngineRpcClient } from '../ports';

/** Canal do worker dono: `engine-rpc:{workerId}` (WROLE-07). */
export const ENGINE_RPC_CHANNEL_PREFIX = 'engine-rpc:';
/** Canal de resposta, um por processo cliente: `engine-rpc-reply:{processId}`. */
export const ENGINE_RPC_REPLY_PREFIX = 'engine-rpc-reply:';
export const ENGINE_RPC_TIMEOUT_MS = 10_000;

export const engineRpcChannel = (workerId: string): string => `${ENGINE_RPC_CHANNEL_PREFIX}${workerId}`;

/**
 * Pedido no fio. `call` é o JSON do `engineCallCodec` (preserva Buffer/Date). `deadline` = epoch ms em que o
 * cliente desiste (agora + timeout): o servidor descarta pedido vencido sem executar (sem efeito tardio).
 */
interface RpcRequest { id: string; replyTo: string; call: string; deadline: number }
/** Resposta no fio. `value` é o JSON do `engineCallCodec`; erro só como `WireError` (WROLE-10). */
type RpcReply = { id: string; ok: true; value: string } | { id: string; ok: false; error: WireError };

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: AppError) => void;
  timer: NodeJS.Timeout;
}

export interface RedisEngineRpcClientOptions {
  /** Cliente de comandos (PUBLISH). */
  publisher: Redis;
  /** Cliente em modo assinante (canal de resposta). Não é fechado aqui (dono: `closeAllRedis`). */
  subscriber: Redis;
  /** Id do processo para o canal de resposta; padrão aleatório. */
  processId?: string;
  timeoutMs?: number;
}

/**
 * http → worker dono por Redis pub/sub request/reply. Sem assinante no canal (`PUBLISH` = 0), sem resposta no
 * prazo ou Redis fora → `EngineNotReadyError`. Erro do worker volta como a mesma classe interna.
 */
export class RedisEngineRpcClient implements IEngineRpcClient {
  private readonly replyChannel: string;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, Pending>();
  private ready: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly options: RedisEngineRpcClientOptions) {
    this.replyChannel = `${ENGINE_RPC_REPLY_PREFIX}${options.processId ?? randomUUID()}`;
    this.timeoutMs = options.timeoutMs ?? ENGINE_RPC_TIMEOUT_MS;
  }

  async call<C extends RpcEngineCall>(workerId: string, call: C): Promise<EngineCallResult<C['method']>> {
    return (await this.dispatch(workerId, call)) as EngineCallResult<C['method']>;
  }

  /** Rejeita pendentes com `EngineNotReadyError` e deixa de assinar. Idempotente. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(new EngineNotReadyError());
    }
    this.options.subscriber.off('message', this.onMessage);
    if (this.ready) {
      await this.ready.catch(() => undefined);
      await this.options.subscriber.unsubscribe(this.replyChannel).catch(() => undefined);
    }
  }

  private async dispatch(workerId: string, call: EngineCall): Promise<unknown> {
    if (this.closed) throw new EngineNotReadyError();
    const payload = encodeEngineCall(call); // erro de serialização é bug do chamador: sobe como está
    try {
      await this.ensureSubscribed();
    } catch (err) {
      logger.warn({ err }, 'RPC da engine: falha ao assinar canal de resposta');
      throw new EngineNotReadyError();
    }
    if (this.closed) throw new EngineNotReadyError();

    const id = randomUUID();
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new EngineNotReadyError());
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });

    const request: RpcRequest = { id, replyTo: this.replyChannel, call: payload, deadline: Date.now() + this.timeoutMs };
    let receivers: number;
    try {
      receivers = await this.options.publisher.publish(engineRpcChannel(workerId), JSON.stringify(request));
    } catch (err) {
      logger.warn({ err, workerId, method: call.method }, 'RPC da engine: PUBLISH falhou');
      receivers = 0;
    }
    if (receivers === 0) this.settle(id, (p) => p.reject(new EngineNotReadyError()));
    return result;
  }

  private ensureSubscribed(): Promise<void> {
    if (!this.ready) {
      const { subscriber } = this.options;
      subscriber.on('message', this.onMessage);
      this.ready = subscriber.subscribe(this.replyChannel).then(() => undefined);
      this.ready.catch(() => {
        subscriber.off('message', this.onMessage);
        this.ready = null; // próxima chamada tenta de novo
      });
    }
    return this.ready;
  }

  private settle(id: string, fn: (p: Pending) => void): void {
    const p = this.pending.get(id);
    if (!p) return; // já resolvido, expirado ou fechado
    this.pending.delete(id);
    clearTimeout(p.timer);
    fn(p);
  }

  private readonly onMessage = (channel: string, message: string): void => {
    if (channel !== this.replyChannel) return;
    let reply: RpcReply;
    try {
      reply = JSON.parse(message) as RpcReply;
    } catch (err) {
      logger.warn({ err }, 'RPC da engine: resposta inválida descartada');
      return;
    }
    if (!reply || typeof reply.id !== 'string') return;
    this.settle(reply.id, (p) => {
      if (!reply.ok) return p.reject(fromWireError(reply.error));
      try {
        p.resolve(decodeEngineValue(reply.value));
      } catch (err) {
        logger.warn({ err }, 'RPC da engine: resultado não decodificável');
        p.reject(fromWireError(undefined));
      }
    });
  };
}

export interface RedisEngineRpcServerOptions {
  workerId: string;
  /** Cliente em modo assinante (canal próprio). Não é fechado aqui. */
  subscriber: Redis;
  /** Cliente de comandos (PUBLISH da resposta). */
  publisher: Redis;
  handler: IEngineCallHandler;
  /** Espera máxima por chamadas em curso no `stop()`; padrão = timeout do cliente (que já desistiu depois disso). */
  drainTimeoutMs?: number;
}

/**
 * Worker: assina `engine-rpc:{workerId}`, executa só chamadas `rpc` do plano na engine local e responde no
 * `replyTo` do pedido com o resultado ou `toWireError`. Pedido malformado sem `replyTo` é descartado; pedido
 * com `deadline` vencido também (o cliente já desistiu: `sendReaction`, `submitLogin*` etc. não rodam tarde).
 * Sem `deadline` (cliente anterior ao campo, deploy escalonado) executa como antes.
 */
export class RedisEngineRpcServer {
  private readonly channel: string;
  private readonly inFlight = new Set<Promise<void>>();
  private listening = false;

  constructor(private readonly options: RedisEngineRpcServerOptions) {
    this.channel = engineRpcChannel(options.workerId);
  }

  /** Idempotente. */
  async start(): Promise<void> {
    if (this.listening) return;
    this.listening = true;
    this.options.subscriber.on('message', this.onMessage);
    try {
      await this.options.subscriber.subscribe(this.channel);
    } catch (err) {
      this.listening = false;
      this.options.subscriber.off('message', this.onMessage);
      throw err;
    }
  }

  /** Para de receber e espera (com limite) as chamadas em curso responderem. Idempotente; não fecha os clientes. */
  async stop(): Promise<void> {
    if (!this.listening) return;
    this.listening = false;
    this.options.subscriber.off('message', this.onMessage);
    await this.options.subscriber.unsubscribe(this.channel).catch(() => undefined);
    if (this.inFlight.size === 0) return;
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.options.drainTimeoutMs ?? ENGINE_RPC_TIMEOUT_MS);
    });
    await Promise.race([Promise.allSettled([...this.inFlight]), limit]);
    clearTimeout(timer);
  }

  private readonly onMessage = (channel: string, message: string): void => {
    if (channel !== this.channel || !this.listening) return;
    let request: Partial<RpcRequest>;
    try {
      request = JSON.parse(message) as Partial<RpcRequest>;
    } catch {
      logger.warn({ channel }, 'RPC da engine: pedido inválido descartado');
      return;
    }
    if (!request || typeof request.id !== 'string' || typeof request.replyTo !== 'string'
      || !request.replyTo.startsWith(ENGINE_RPC_REPLY_PREFIX)) {
      logger.warn({ channel }, 'RPC da engine: pedido sem id/replyTo descartado');
      return;
    }
    if (typeof request.deadline === 'number' && Date.now() > request.deadline) {
      logger.warn({ channel, lateMs: Date.now() - request.deadline }, 'RPC da engine: pedido vencido descartado');
      return;
    }
    const task = this.process(request.id, request.replyTo, request.call);
    this.inFlight.add(task);
    void task.finally(() => this.inFlight.delete(task));
  };

  private async process(id: string, replyTo: string, rawCall: unknown): Promise<void> {
    let reply: RpcReply;
    try {
      if (typeof rawCall !== 'string') throw new TypeError('engine rpc: chamada ausente');
      const call = decodeEngineCall(rawCall);
      if (engineCallKind(call.method) !== 'rpc') throw new TypeError(`engine rpc: ${call.method} não é rpc`);
      const value = await this.options.handler.handle(call);
      reply = { id, ok: true, value: encodeEngineValue(value) };
    } catch (err) {
      if (!(err instanceof AppError)) logger.warn({ err }, 'RPC da engine: falha não tipada');
      reply = { id, ok: false, error: toWireError(err) };
    }
    try {
      await this.options.publisher.publish(replyTo, JSON.stringify(reply));
    } catch (err) {
      logger.warn({ err, workerId: this.options.workerId }, 'RPC da engine: resposta não publicada');
    }
  }
}
