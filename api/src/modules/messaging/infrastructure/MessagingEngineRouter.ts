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
import { SessionNotFoundError } from '../../../shared/errors/internal/SessionErrors';

const DEFAULT_ENGINE = 'baileys';
const CACHE_MAX = 10_000;

/**
 * Uma única `IMessagingEngine` para o resto do sistema, que despacha cada chamada para a engine
 * da sessão (`Session.engine`). Quem consome a porta não sabe quantas engines existem.
 *
 * O mapa sessionId → engine fica em memória (preenchido no primeiro uso e nas operações de
 * conexão). `createOutboundMessageId` é síncrono: usa só o cache, que já foi populado pela
 * conexão/reconexão que necessariamente veio antes de qualquer envio neste processo; sem
 * entrada, cai na engine padrão (comportamento anterior).
 */
export class MessagingEngineRouter implements IMessagingEngine {
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
  createOutboundMessageId(sessionId: string): string { return this.resolveSync(sessionId).createOutboundMessageId(sessionId); }
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
