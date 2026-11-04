import type { EngineCall, EngineCallResult, EngineMethod, QueuedEngineCall, RpcEngineCall } from './engineCallPlan';

/** Alvo de comando: id do worker dono (lease) ou a fila compartilhada de abertura. */
export const SESSION_OPEN_TARGET = 'open' as const;
export type EngineCommandTarget = string; // workerId | typeof SESSION_OPEN_TARGET

type ResultOf<C extends { method: EngineMethod }> = EngineCallResult<C['method']>;

/** http → worker dono: request/reply (Redis). Sem resposta no prazo → `EngineNotReadyError` (WROLE-07). */
export interface IEngineRpcClient {
  call<C extends RpcEngineCall>(workerId: string, call: C): Promise<ResultOf<C>>;
  close(): Promise<void>;
}

/**
 * http → fila do dono (`command`/`open` com dono vivo) ou `session-open` (`open` sem dono). Espera o resultado;
 * timeout → `EngineNotReadyError`, e job ainda em espera é removido (WROLE-06/08).
 */
export interface IEngineCommandProducer {
  send<C extends QueuedEngineCall>(target: EngineCommandTarget, call: C, timeoutMs: number): Promise<ResultOf<C>>;
  close(): Promise<void>;
}

/** Worker: executa a chamada recebida na engine local. Erro lançado volta tipado (`toWireError`). */
export interface IEngineCallHandler {
  handle(call: EngineCall): Promise<unknown>;
}
