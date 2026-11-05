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
} from '../domain/contracts/IMessagingEngine';
import type { SessionStatus } from '../../sessions/domain/enums/SessionStatus';
import type { ISessionRepository } from '../../sessions/domain/contracts/ISessionRepository';
import type { ISessionSocketControl, SessionResumeResult } from '../domain/contracts/ISessionSocketControl';
import { SessionNotFoundError } from '../../../shared/errors/internal/SessionErrors';
import { logger } from '../../../shared/logger/logger';

const DEFAULT_ENGINE = 'baileys';
const CACHE_MAX = 10_000;

/**
 * Uma única `IMessagingEngine` para o resto do sistema, que despacha cada chamada para a engine
 * da sessão (`Session.engine`). Quem consome a porta não sabe quantas engines existem.
 *
 * O mapa sessionId → engine fica em memória (preenchido no primeiro uso e nas operações de
 * conexão). `createOutboundMessageId` usa só o cache (sem ida ao banco), que já foi populado pela
 * conexão/reconexão que necessariamente veio antes de qualquer envio neste processo; sem
 * entrada, cai na engine padrão (comportamento anterior).
 */
function hasSocketControl(engine: IMessagingEngine): engine is IMessagingEngine & ISessionSocketControl {
  const e = engine as Partial<ISessionSocketControl>;
  return typeof e.abortSession === 'function' && typeof e.suspendSession === 'function' && typeof e.resumeSession === 'function'
    && typeof e.forgetSuspension === 'function'
    && typeof e.closeAllSockets === 'function' && typeof e.listLocalSessionIds === 'function';
}

export class MessagingEngineRouter implements IMessagingEngine, ISessionSocketControl {
  private readonly engineBySession = new Map<string, string>();

  constructor(
    private readonly engines: ReadonlyMap<string, IMessagingEngine>,
    private readonly sessionRepo: Pick<ISessionRepository, 'findEngineById'>,
  ) {
    if (!engines.has(DEFAULT_ENGINE)) throw new Error(`MessagingEngineRouter requires the '${DEFAULT_ENGINE}' engine`);
  }

  /** Engines registradas (para `GET /sessions/limits` e validação de criação). */
  get enabledEngines(): ReadonlySet<string> {
    return new Set(this.engines.keys());
  }

  private remember(sessionId: string, engine: string): void {
    if (this.engineBySession.size >= CACHE_MAX) {
      const first = this.engineBySession.keys().next().value;
      if (first !== undefined) this.engineBySession.delete(first);
    }
    this.engineBySession.set(sessionId, engine);
  }

  private pick(engine: string): IMessagingEngine {
    return this.engines.get(engine) ?? this.engines.get(DEFAULT_ENGINE)!;
  }

  private async resolve(sessionId: string): Promise<IMessagingEngine> {
    const cached = this.engineBySession.get(sessionId);
    if (cached) return this.pick(cached);
    const engine = await this.sessionRepo.findEngineById(sessionId);
    if (!engine) throw new SessionNotFoundError(sessionId);
    this.remember(sessionId, engine);
    return this.pick(engine);
  }

  private socketControls(): Array<[string, ISessionSocketControl]> {
    return Array.from(this.engines).filter((pair): pair is [string, IMessagingEngine & ISessionSocketControl] => hasSocketControl(pair[1]));
  }

  /**
   * Derruba o socket local na engine da sessão. Sessão sem engine conhecida (apagada no banco):
   * pede a todas, pois cada uma ignora sessão sem socket local.
   */
  async abortSession(sessionId: string): Promise<void> {
    let engine: IMessagingEngine;
    try {
      engine = await this.resolve(sessionId);
    } catch (err) {
      if (!(err instanceof SessionNotFoundError)) throw err;
      await Promise.all(this.socketControls().map(([, control]) => control.abortSession(sessionId)));
      return;
    }
    if (hasSocketControl(engine)) await engine.abortSession(sessionId);
  }

  /** Suspende na engine da sessão; sem engine conhecida pede a todas (cada uma ignora sem socket local). */
  async suspendSession(sessionId: string): Promise<void> {
    let engine: IMessagingEngine;
    try {
      engine = await this.resolve(sessionId);
    } catch (err) {
      if (!(err instanceof SessionNotFoundError)) throw err;
      await Promise.all(this.socketControls().map(([, control]) => control.suspendSession(sessionId)));
      return;
    }
    if (hasSocketControl(engine)) await engine.suspendSession(sessionId);
  }

  /** Reabre na engine da sessão; sessão apagada no banco = `gone` (erro transitório do banco lança). */
  async resumeSession(sessionId: string): Promise<SessionResumeResult> {
    let engine: IMessagingEngine;
    try {
      engine = await this.resolve(sessionId);
    } catch (err) {
      if (err instanceof SessionNotFoundError) return 'gone';
      throw err;
    }
    return hasSocketControl(engine) ? engine.resumeSession(sessionId) : 'gone';
  }

  /** Esquece a suspensão em todas as engines (só a da sessão tem entrada); devolve o tenant guardado. */
  async forgetSuspension(sessionId: string): Promise<string | null> {
    const tenants = await Promise.all(this.socketControls().map(([, control]) => control.forgetSuspension(sessionId)));
    return tenants.find((t) => t !== null) ?? null;
  }

  /** Fecha os sockets de todas as engines; espera todas mesmo se uma falhar (shutdown segue). */
  async closeAllSockets(): Promise<void> {
    const controls = this.socketControls();
    const results = await Promise.allSettled(controls.map(([, control]) => control.closeAllSockets()));
    results.forEach((result, i) => {
      if (result.status === 'rejected') logger.warn({ engine: controls[i][0], err: result.reason }, 'closeAllSockets failed for engine');
    });
  }

  listLocalSessionIds(): string[] {
    return this.socketControls().flatMap(([, control]) => control.listLocalSessionIds());
  }

  private resolveSync(sessionId: string): IMessagingEngine {
    return this.pick(this.engineBySession.get(sessionId) ?? DEFAULT_ENGINE);
  }

  async createSession(input: CreateSessionInput) { return (await this.resolve(input.sessionId)).createSession(input); }
  async connectSession(input: ConnectSessionInput): Promise<ConnectSessionResult> { return (await this.resolve(input.sessionId)).connectSession(input); }
  async disconnectSession(input: DisconnectSessionInput) { return (await this.resolve(input.sessionId)).disconnectSession(input); }
  async reconnectSession(input: ReconnectSessionInput) { return (await this.resolve(input.sessionId)).reconnectSession(input); }
  async logoutSession(input: LogoutSessionInput) { return (await this.resolve(input.sessionId)).logoutSession(input); }
  async getSessionStatus(sessionId: string): Promise<SessionStatus> { return (await this.resolve(sessionId)).getSessionStatus(sessionId); }
  async getSessionQr(sessionId: string) { return (await this.resolve(sessionId)).getSessionQr(sessionId); }
  async getSessionPairingCode(sessionId: string) { return (await this.resolve(sessionId)).getSessionPairingCode(sessionId); }
  async requestPairingCode(input: RequestPairingCodeInput): Promise<RequestPairingCodeResult> { return (await this.resolve(input.sessionId)).requestPairingCode(input); }
  async requestLoginCode(input: RequestLoginCodeInput): Promise<LoginStepResult> { return (await this.resolve(input.sessionId)).requestLoginCode(input); }
  async submitLoginCode(input: SubmitLoginCodeInput): Promise<LoginStepResult> { return (await this.resolve(input.sessionId)).submitLoginCode(input); }
  async submitLoginPassword(input: SubmitLoginPasswordInput): Promise<LoginStepResult> { return (await this.resolve(input.sessionId)).submitLoginPassword(input); }
  async sendTextMessage(input: SendTextMessageInput): Promise<SendMessageResult> { return (await this.resolve(input.sessionId)).sendTextMessage(input); }
  async createOutboundMessageId(sessionId: string): Promise<string> { return this.resolveSync(sessionId).createOutboundMessageId(sessionId); }
  async sendMediaMessage(input: SendMediaMessageInput): Promise<SendMessageResult> { return (await this.resolve(input.sessionId)).sendMediaMessage(input); }
  async sendReaction(input: SendReactionInput): Promise<SendMessageResult> { return (await this.resolve(input.sessionId)).sendReaction(input); }
  async markMessagesRead(input: MarkMessagesReadInput) { return (await this.resolve(input.sessionId)).markMessagesRead(input); }
  async presenceSubscribe(sessionId: string, phone: string) { return (await this.resolve(sessionId)).presenceSubscribe(sessionId, phone); }
  async sendPresence(sessionId: string, to: string, presence: 'composing' | 'paused') { return (await this.resolve(sessionId)).sendPresence(sessionId, to, presence); }
  async getGroupParticipants(sessionId: string, groupJid: string): Promise<GroupParticipantInfo[]> { return (await this.resolve(sessionId)).getGroupParticipants(sessionId, groupJid); }
  async listParticipatingGroups(sessionId: string): Promise<ParticipatingGroupInfo[]> { return (await this.resolve(sessionId)).listParticipatingGroups(sessionId); }
  async getGroupInviteLink(sessionId: string, groupJid: string) { return (await this.resolve(sessionId)).getGroupInviteLink(sessionId, groupJid); }
  async getGroupSummary(sessionId: string, groupJid: string) { return (await this.resolve(sessionId)).getGroupSummary(sessionId, groupJid); }
  async fetchProfilePicture(sessionId: string, jid: string, isGroup: boolean) { return (await this.resolve(sessionId)).fetchProfilePicture(sessionId, jid, isGroup); }
  async checkNumberExists(sessionId: string, phone: string) { return (await this.resolve(sessionId)).checkNumberExists(sessionId, phone); }
  async updateChatState(input: UpdateChatStateInput) { return (await this.resolve(input.sessionId)).updateChatState(input); }
}
