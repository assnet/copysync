import type {
  IMessagingEngine,
  CreateSessionInput,
  ConnectSessionInput,
  ConnectSessionResult,
  DisconnectSessionInput,
  ReconnectSessionInput,
  LogoutSessionInput,
  RequestPairingCodeInput,
  RequestPairingCodeResult,
  RequestLoginCodeInput,
  SubmitLoginCodeInput,
  SubmitLoginPasswordInput,
  LoginStepResult,
  SendTextMessageInput,
  SendMediaMessageInput,
  SendMessageResult,
  SendReactionInput,
  MarkMessagesReadInput,
  GroupParticipantInfo,
  ParticipatingGroupInfo,
  UpdateChatStateInput,
} from '../../domain/contracts/IMessagingEngine';
import type { SessionStatus } from '../../../sessions/domain/enums/SessionStatus';
import type { ISessionLeaseRepository } from '../../../sessions/domain/contracts/ISessionLeaseRepository';
import {
  InvalidSessionStateError,
  SessionNotConnectedError,
  SessionNotOwnedError,
} from '../../../../shared/errors/internal/SessionErrors';
import { EngineNotReadyError } from '../../../../shared/errors/internal/MessagingErrors';
import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import { logger } from '../../../../shared/logger/logger';
import {
  engineCall,
  engineCallKind,
  engineCallSessionId,
  type EngineCall,
  type EngineCallOf,
  type EngineCallResult,
  type EngineMethod,
  type QueuedEngineCall,
  type RpcEngineCall,
} from './engineCallPlan';
import { SESSION_OPEN_TARGET, type IEngineCommandProducer, type IEngineRpcClient } from './ports';

export interface RemoteEngineTimeouts {
  /** Espera do resultado de `command`/`open` (exceto mídia). */
  commandMs: number;
  /** Espera do `sendMediaMessage`: upload ao WhatsApp/Telegram pode levar minutos. */
  mediaMs: number;
}

export const DEFAULT_REMOTE_ENGINE_TIMEOUTS: RemoteEngineTimeouts = { commandMs: 60_000, mediaMs: 300_000 };

export interface RemoteMessagingEngineDeps {
  owners: Pick<ISessionLeaseRepository, 'findLiveOwner'>;
  rpc: IEngineRpcClient;
  commands: IEngineCommandProducer;
  /** Engines ligadas na plataforma, calculadas da env sem instanciar engine (`enabledEnginesFromEnv`). */
  enabledEngines: ReadonlySet<string>;
  timeouts?: Partial<RemoteEngineTimeouts>;
}

/** Engines ligadas pela env, com a mesma regra do `MessagingEngineFactory.createRouter`, sem carregar Baileys/GramJS. */
export function enabledEnginesFromEnv(cfg: {
  telegramEnabled: boolean;
  telegramApiId?: number;
  telegramApiHash?: string;
  /** `SecretCipherFactory.check()`: `null` = cifra disponível. */
  cipherProblem: string | null;
}): ReadonlySet<string> {
  const set = new Set<string>(['baileys']);
  if (cfg.telegramEnabled && cfg.telegramApiId && cfg.telegramApiHash && !cfg.cipherProblem) set.add('telegram');
  return set;
}

/**
 * Sem dono vivo, devolve o mesmo que a engine local devolve sem socket (paridade de contrato);
 * `undefined` = não há resposta benigna, lança.
 */
function noOwnerResult(call: EngineCall): { value: unknown } | undefined {
  switch (call.method) {
    case 'getSessionStatus':
      return { value: 'DISCONNECTED' satisfies SessionStatus };
    case 'getSessionQr':
    case 'getSessionPairingCode':
    case 'fetchProfilePicture':
    case 'checkNumberExists':
      return { value: null };
    case 'markMessagesRead':
    case 'presenceSubscribe':
      return { value: undefined };
    default:
      return undefined;
  }
}

/**
 * `IMessagingEngine` do processo `http` (WROLE-05): não carrega engine. Cada método segue `ENGINE_CALL_PLAN`:
 * `rpc` → RPC no dono vivo; `command` → fila BullMQ do dono; `open` → fila do dono ou `session-open` sem dono;
 * `local` → só o evento local. Dono vem do lease (`findLiveOwner`); `SESSION_NOT_OWNED` re-resolve 1 vez (WROLE-09).
 * Não implementa `ISessionSocketControl`: socket só existe no worker.
 */
export class RemoteMessagingEngineAdapter implements IMessagingEngine {
  private readonly timeouts: RemoteEngineTimeouts;

  constructor(private readonly deps: RemoteMessagingEngineDeps) {
    this.timeouts = { ...DEFAULT_REMOTE_ENGINE_TIMEOUTS, ...deps.timeouts };
  }

  get enabledEngines(): ReadonlySet<string> {
    return this.deps.enabledEngines;
  }

  private async dispatch<M extends EngineMethod>(call: EngineCallOf<M>): Promise<EngineCallResult<M>> {
    const c = call as unknown as EngineCall;
    const sessionId = engineCallSessionId(c);
    try {
      return (await this.attempt(c, sessionId)) as EngineCallResult<M>;
    } catch (err) {
      if (!(err instanceof SessionNotOwnedError)) throw err;
      logger.debug({ sessionId, method: c.method }, 'remote engine: owner changed, re-resolving');
    }
    try {
      return (await this.attempt(c, sessionId)) as EngineCallResult<M>;
    } catch (err) {
      // Dono trocou duas vezes seguidas: posse em transição. Interno não sai em HTTP.
      if (err instanceof SessionNotOwnedError) throw new EngineNotReadyError();
      throw err;
    }
  }

  private async attempt(call: EngineCall, sessionId: string): Promise<unknown> {
    const kind = engineCallKind(call.method);
    const owner = await this.deps.owners.findLiveOwner(sessionId);
    if (kind === 'open') {
      return this.deps.commands.send(owner ?? SESSION_OPEN_TARGET, call as QueuedEngineCall, this.timeouts.commandMs);
    }
    if (!owner) return this.noOwner(call, sessionId);
    if (kind === 'rpc') return this.deps.rpc.call(owner, call as RpcEngineCall);
    if (kind === 'command') {
      const ms = call.method === 'sendMediaMessage' ? this.timeouts.mediaMs : this.timeouts.commandMs;
      return this.deps.commands.send(owner, call as QueuedEngineCall, ms);
    }
    throw new TypeError(`remote engine: ${call.method} (${kind}) não roteável`);
  }

  private noOwner(call: EngineCall, sessionId: string): unknown {
    if (call.method === 'submitLoginCode' || call.method === 'submitLoginPassword') {
      throw new InvalidSessionStateError(sessionId, 'DISCONNECTED');
    }
    const benign = noOwnerResult(call);
    if (benign) return benign.value;
    throw new SessionNotConnectedError(sessionId);
  }

  // ── local ───────────────────────────────────────────────────────────────────

  async createSession(input: CreateSessionInput): Promise<void> {
    internalEventBus.emit('SESSION_CREATED', { type: 'SESSION_CREATED', sessionId: input.sessionId, tenantId: input.tenantId });
  }

  // ── open ────────────────────────────────────────────────────────────────────

  connectSession(input: ConnectSessionInput): Promise<ConnectSessionResult> {
    return this.dispatch(engineCall('connectSession', input));
  }
  reconnectSession(input: ReconnectSessionInput): Promise<void> {
    return this.dispatch(engineCall('reconnectSession', input));
  }
  requestPairingCode(input: RequestPairingCodeInput): Promise<RequestPairingCodeResult> {
    return this.dispatch(engineCall('requestPairingCode', input));
  }
  requestLoginCode(input: RequestLoginCodeInput): Promise<LoginStepResult> {
    return this.dispatch(engineCall('requestLoginCode', input));
  }

  // ── command ─────────────────────────────────────────────────────────────────

  disconnectSession(input: DisconnectSessionInput): Promise<void> {
    return this.dispatch(engineCall('disconnectSession', input));
  }
  logoutSession(input: LogoutSessionInput): Promise<void> {
    return this.dispatch(engineCall('logoutSession', input));
  }
  sendTextMessage(input: SendTextMessageInput): Promise<SendMessageResult> {
    return this.dispatch(engineCall('sendTextMessage', input));
  }
  sendMediaMessage(input: SendMediaMessageInput): Promise<SendMessageResult> {
    return this.dispatch(engineCall('sendMediaMessage', input));
  }

  // ── rpc ─────────────────────────────────────────────────────────────────────

  getSessionStatus(sessionId: string): Promise<SessionStatus> {
    return this.dispatch(engineCall('getSessionStatus', sessionId));
  }
  getSessionQr(sessionId: string): Promise<string | null> {
    return this.dispatch(engineCall('getSessionQr', sessionId));
  }
  getSessionPairingCode(sessionId: string): Promise<string | null> {
    return this.dispatch(engineCall('getSessionPairingCode', sessionId));
  }
  submitLoginCode(input: SubmitLoginCodeInput): Promise<LoginStepResult> {
    return this.dispatch(engineCall('submitLoginCode', input));
  }
  submitLoginPassword(input: SubmitLoginPasswordInput): Promise<LoginStepResult> {
    return this.dispatch(engineCall('submitLoginPassword', input));
  }
  createOutboundMessageId(sessionId: string): Promise<string> {
    return this.dispatch(engineCall('createOutboundMessageId', sessionId));
  }
  sendReaction(input: SendReactionInput): Promise<SendMessageResult> {
    return this.dispatch(engineCall('sendReaction', input));
  }
  markMessagesRead(input: MarkMessagesReadInput): Promise<void> {
    return this.dispatch(engineCall('markMessagesRead', input));
  }
  presenceSubscribe(sessionId: string, phone: string): Promise<void> {
    return this.dispatch(engineCall('presenceSubscribe', sessionId, phone));
  }
  sendPresence(sessionId: string, to: string, presence: 'composing' | 'paused'): Promise<void> {
    return this.dispatch(engineCall('sendPresence', sessionId, to, presence));
  }
  getGroupParticipants(sessionId: string, groupJid: string): Promise<GroupParticipantInfo[]> {
    return this.dispatch(engineCall('getGroupParticipants', sessionId, groupJid));
  }
  listParticipatingGroups(sessionId: string): Promise<ParticipatingGroupInfo[]> {
    return this.dispatch(engineCall('listParticipatingGroups', sessionId));
  }
  getGroupInviteLink(sessionId: string, groupJid: string): Promise<{ inviteCode: string }> {
    return this.dispatch(engineCall('getGroupInviteLink', sessionId, groupJid));
  }
  getGroupSummary(sessionId: string, groupJid: string): Promise<{ name: string; memberCount: number; isSelfAdmin: boolean }> {
    return this.dispatch(engineCall('getGroupSummary', sessionId, groupJid));
  }
  fetchProfilePicture(sessionId: string, jid: string, isGroup: boolean): Promise<string | null> {
    return this.dispatch(engineCall('fetchProfilePicture', sessionId, jid, isGroup));
  }
  checkNumberExists(sessionId: string, phone: string): Promise<boolean | null> {
    return this.dispatch(engineCall('checkNumberExists', sessionId, phone));
  }
  updateChatState(input: UpdateChatStateInput): Promise<void> {
    return this.dispatch(engineCall('updateChatState', input));
  }
}
