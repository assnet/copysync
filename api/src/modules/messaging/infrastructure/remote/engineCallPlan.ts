import type { IMessagingEngine } from '../../domain/contracts/IMessagingEngine';

/**
 * Roteamento de cada método de `IMessagingEngine` entre processos (`http` → `worker`). Puro, sem transporte.
 * - `local`: roda no próprio processo (`createSession` só emite `SESSION_CREATED` local).
 * - `rpc`: depende da memória do dono; request/reply no Redis, timeout curto (WROLE-07).
 * - `command`: efeito durável; fila BullMQ do dono, quem chama espera o resultado (WROLE-06).
 * - `open`: abre socket; vai ao dono vivo ou à fila compartilhada `session-open` (WROLE-08).
 */
export type EngineCallKind = 'local' | 'rpc' | 'command' | 'open';

export type EngineMethod = keyof IMessagingEngine;

/** `satisfies` obriga todo método do contrato (e só eles): método novo sem entrada não compila. */
export const ENGINE_CALL_PLAN = {
  createSession: 'local',
  connectSession: 'open',
  reconnectSession: 'open',
  requestPairingCode: 'open',
  requestLoginCode: 'open',
  disconnectSession: 'command',
  logoutSession: 'command',
  sendTextMessage: 'command',
  sendMediaMessage: 'command',
  getSessionStatus: 'rpc',
  getSessionQr: 'rpc',
  getSessionPairingCode: 'rpc',
  submitLoginCode: 'rpc',
  submitLoginPassword: 'rpc',
  createOutboundMessageId: 'rpc',
  sendReaction: 'rpc',
  markMessagesRead: 'rpc',
  presenceSubscribe: 'rpc',
  sendPresence: 'rpc',
  getGroupParticipants: 'rpc',
  listParticipatingGroups: 'rpc',
  getGroupInviteLink: 'rpc',
  getGroupSummary: 'rpc',
  fetchProfilePicture: 'rpc',
  checkNumberExists: 'rpc',
  updateChatState: 'rpc',
} as const satisfies Record<EngineMethod, EngineCallKind>;

export type EngineMethodsOf<K extends EngineCallKind> = {
  [M in EngineMethod]: (typeof ENGINE_CALL_PLAN)[M] extends K ? M : never;
}[EngineMethod];

/** Chamada serializável: nome do método + argumentos posicionais do contrato. */
export type EngineCallOf<M extends EngineMethod> = { method: M; args: Parameters<IMessagingEngine[M]> };
export type EngineCall = { [M in EngineMethod]: EngineCallOf<M> }[EngineMethod];
export type EngineCallResult<M extends EngineMethod> = Awaited<ReturnType<IMessagingEngine[M]>>;

/** União distribuída: cada método com os próprios args. */
export type EngineCallsOf<K extends EngineCallKind> = { [M in EngineMethodsOf<K>]: EngineCallOf<M> }[EngineMethodsOf<K>];
export type RpcEngineCall = EngineCallsOf<'rpc'>;
export type CommandEngineCall = EngineCallsOf<'command'>;
export type OpenEngineCall = EngineCallsOf<'open'>;
/** O que vai para a fila BullMQ (do dono ou `session-open`). */
export type QueuedEngineCall = CommandEngineCall | OpenEngineCall;

const METHODS = new Set<string>(Object.keys(ENGINE_CALL_PLAN));

export function isEngineMethod(name: unknown): name is EngineMethod {
  return typeof name === 'string' && METHODS.has(name);
}

export function engineCallKind(method: EngineMethod): EngineCallKind {
  return ENGINE_CALL_PLAN[method];
}

/** Monta a chamada com tipo correlacionado entre método e argumentos. */
export function engineCall<M extends EngineMethod>(method: M, ...args: Parameters<IMessagingEngine[M]>): EngineCallOf<M> {
  return { method, args };
}

/** Sessão alvo: 1º argumento string (`sessionId`) ou `input.sessionId`. */
export function engineCallSessionId(call: EngineCall): string {
  const first: unknown = call.args[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && typeof (first as { sessionId?: unknown }).sessionId === 'string') {
    return (first as { sessionId: string }).sessionId;
  }
  throw new TypeError(`engine call ${call.method} sem sessionId`);
}
