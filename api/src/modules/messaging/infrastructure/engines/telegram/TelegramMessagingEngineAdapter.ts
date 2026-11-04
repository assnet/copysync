/**
 * TelegramMessagingEngineAdapter
 *
 * `IMessagingEngine` sobre a lib `telegram` (GramJS, MTProto) com **conta de usuário**: a mesma
 * conta do celular do operador. Nada de bot nem de número da plataforma. Só este diretório
 * importa `telegram`; tudo que sai daqui está em tipos internos.
 *
 * Identificadores: `to`/`groupJid`/`from` são o **peer id marcado** do Telegram em texto
 * (`"123456"` usuário, `"-123456"` grupo pequeno, `"-100123456"` supergrupo/canal). Sufixo
 * `@g.us`/`@s.whatsapp.net` que o chat anexa é descartado.
 *
 * Login: `client.start` (telefone → código → senha 2FA) ou `signInUserWithQrCode`, ambos em
 * background esperando o operador por `Deferred`s (ver `TelegramSessionRegistry.PendingLogin`).
 */
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, type NewMessageEvent } from 'telegram/events';
import { Logger, LogLevel } from 'telegram/extensions/Logger';
import { getPeerId } from 'telegram/Utils';
import bigInt from 'big-integer';
import { randomBytes } from 'node:crypto';
import { logger as appLogger } from '../../../../../shared/logger/logger';
import { internalEventBus } from '../../../../../shared/events/InternalEventBus';
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
} from '../../../domain/contracts/IMessagingEngine';
import type { SessionStatus } from '../../../../sessions/domain/enums/SessionStatus';
import type { ISessionRepository } from '../../../../sessions/domain/contracts/ISessionRepository';
import { SessionNotConnectedError, SessionNotFoundError } from '../../../../../shared/errors/internal/SessionErrors';
import { EngineOperationUnsupportedError, MessageSendFailedError } from '../../../../../shared/errors/internal/MessagingErrors';
import { TelegramLoginNotPendingError } from '../../../../../shared/errors/internal/TelegramErrors';
import { TelegramSessionRegistry, type PendingLogin, type TelegramSessionEntry } from './TelegramSessionRegistry';
import type { TelegramAuthStatePersistence } from './TelegramAuthStatePersistence';
import { Deferred } from './deferred';
import { isAuthCancel, isLoggedOutError, translateTelegramLoginError, translateTelegramSendError } from './TelegramErrorTranslator';

const telegramLogger = appLogger.child({ module: 'TelegramEngine' });
const ENGINE = 'telegram';

export interface TelegramEngineConfig {
  apiId: number;
  apiHash: string;
}

function stripSuffix(id: string): string {
  return id.split('@')[0];
}

function peerString(peer: Api.TypePeer | undefined | null): string | null {
  if (!peer) return null;
  try {
    return getPeerId(peer, true);
  } catch {
    return null;
  }
}

function displayName(entity: unknown): string | undefined {
  const e = entity as { firstName?: string; lastName?: string; username?: string; title?: string } | undefined;
  if (!e) return undefined;
  if (e.title) return e.title;
  const name = [e.firstName, e.lastName].filter(Boolean).join(' ').trim();
  return name || e.username || undefined;
}

function mediaType(media: Api.TypeMessageMedia | undefined): string {
  if (!media) return 'text';
  if (media instanceof Api.MessageMediaPhoto) return 'image';
  if (media instanceof Api.MessageMediaDocument) {
    const doc = media.document instanceof Api.Document ? media.document : null;
    const mime = doc?.mimeType ?? '';
    const attrs = doc?.attributes ?? [];
    if (attrs.some((a) => a instanceof Api.DocumentAttributeAudio && a.voice)) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    return 'document';
  }
  if (media instanceof Api.MessageMediaWebPage) return 'text';
  return 'text';
}

export class TelegramMessagingEngineAdapter implements IMessagingEngine {
  private readonly registry = new TelegramSessionRegistry();

  constructor(
    private readonly config: TelegramEngineConfig,
    private readonly sessionRepo: ISessionRepository,
    private readonly auth: TelegramAuthStatePersistence,
  ) {}

  // ── Ciclo de vida ──────────────────────────────────────────────────────────

  async createSession(input: CreateSessionInput): Promise<void> {
    internalEventBus.emit('SESSION_CREATED', { type: 'SESSION_CREATED', sessionId: input.sessionId, tenantId: input.tenantId });
  }

  /** Abre o cliente; com credenciais salvas conecta direto, sem elas inicia o login por QR. */
  async connectSession(input: ConnectSessionInput): Promise<ConnectSessionResult> {
    const entry = await this.openClient(input.sessionId, input.tenantId);
    if (await entry.client.checkAuthorization()) {
      await this.finishLogin(input.sessionId, entry);
      return {};
    }
    this.startQrLogin(input.sessionId, entry);
    return {};
  }

  async reconnectSession(input: ReconnectSessionInput): Promise<void> {
    const saved = await this.auth.load(input.sessionId, input.tenantId);
    if (!saved) {
      // Nunca logou (ou saiu): como no WhatsApp, reconectar sem credencial abre o login por QR
      const entry = await this.openClient(input.sessionId, input.tenantId, null);
      this.startQrLogin(input.sessionId, entry);
      return;
    }
    const entry = await this.openClient(input.sessionId, input.tenantId, saved);
    if (await entry.client.checkAuthorization()) {
      await this.finishLogin(input.sessionId, entry);
      return;
    }
    await this.auth.clear(input.sessionId);
    await this.teardown(input.sessionId, entry);
    await this.updateStatus(input.sessionId, input.tenantId, 'LOGGED_OUT');
    internalEventBus.emit('SESSION_LOGGED_OUT', { type: 'SESSION_LOGGED_OUT', sessionId: input.sessionId, tenantId: input.tenantId });
  }

  async disconnectSession(input: DisconnectSessionInput): Promise<void> {
    const entry = this.registry.get(input.sessionId);
    if (entry) await this.teardown(input.sessionId, entry);
    await this.sessionRepo
      .updateStatus(input.sessionId, input.tenantId, { status: 'DISCONNECTED', lastDisconnectedAt: new Date() })
      .catch(() => undefined);
    internalEventBus.emit('SESSION_DISCONNECTED', { type: 'SESSION_DISCONNECTED', sessionId: input.sessionId, tenantId: input.tenantId, reason: 'manual' });
  }

  async logoutSession(input: LogoutSessionInput): Promise<void> {
    const entry = this.registry.get(input.sessionId);
    if (entry) {
      try {
        if (await entry.client.checkAuthorization()) await entry.client.invoke(new Api.auth.LogOut());
      } catch (err) {
        telegramLogger.warn({ err, sessionId: input.sessionId }, 'Telegram logout request failed — clearing locally');
      }
      await this.teardown(input.sessionId, entry);
    }
    await this.auth.clear(input.sessionId);
    await this.updateStatus(input.sessionId, input.tenantId, 'LOGGED_OUT');
    internalEventBus.emit('SESSION_LOGGED_OUT', { type: 'SESSION_LOGGED_OUT', sessionId: input.sessionId, tenantId: input.tenantId });
  }

  async getSessionStatus(sessionId: string): Promise<SessionStatus> {
    const entry = this.registry.get(sessionId);
    if (!entry) return 'DISCONNECTED';
    if (entry.pending) {
      if (entry.pending.mode === 'qr') return entry.pending.password.settled ? 'CONNECTING' : 'AWAITING_QR';
      return 'AWAITING_CODE';
    }
    return entry.client.connected ? 'CONNECTED' : 'DISCONNECTED';
  }

  async getSessionQr(sessionId: string): Promise<string | null> {
    return this.registry.get(sessionId)?.latestQr ?? null;
  }

  async getSessionPairingCode(): Promise<string | null> {
    return null;
  }

  async requestPairingCode(input: RequestPairingCodeInput): Promise<RequestPairingCodeResult> {
    void input;
    throw new EngineOperationUnsupportedError(ENGINE, 'requestPairingCode');
  }

  // ── Login por código ───────────────────────────────────────────────────────

  async requestLoginCode(input: RequestLoginCodeInput): Promise<LoginStepResult> {
    const entry = await this.openClient(input.sessionId, input.tenantId);
    if (await entry.client.checkAuthorization()) {
      await this.finishLogin(input.sessionId, entry);
      return { status: 'CONNECTED' };
    }
    const pending = this.newPending('code');
    entry.pending = pending;
    const { sessionId, tenantId } = input;

    pending.flow = entry.client
      .start({
        phoneNumber: `+${input.phone}`,
        phoneCode: async () => {
          if (!pending.codeSent.settled) pending.codeSent.resolve();
          await this.updateStatus(sessionId, tenantId, 'AWAITING_CODE');
          pending.code = new Deferred<string>();
          return pending.code.promise;
        },
        password: async () => {
          await this.updateStatus(sessionId, tenantId, 'AWAITING_PASSWORD');
          pending.waiter?.resolve({ status: 'AWAITING_PASSWORD' });
          pending.waiter = null;
          pending.password = new Deferred<string>();
          return pending.password.promise;
        },
        onError: async (err) => {
          if (isAuthCancel(err)) return true;
          const translated = translateTelegramLoginError(err);
          if (pending.waiter) {
            pending.waiter.reject(translated);
            pending.waiter = null;
            return false; // a lib pede o código/senha de novo
          }
          // Erro antes de o operador digitar (ex.: telefone inválido no envio do código)
          if (!pending.codeSent.settled) pending.codeSent.reject(translated);
          return true;
        },
      })
      .then(() => this.finishLogin(sessionId, entry))
      .catch(async (err) => {
        if (!pending.codeSent.settled) pending.codeSent.reject(translateTelegramLoginError(err));
        pending.waiter?.reject(translateTelegramLoginError(err));
        pending.waiter = null;
        if (!isAuthCancel(err)) telegramLogger.warn({ err, sessionId }, 'Telegram code login flow ended with error');
        if (this.registry.isCurrent(sessionId, entry.epoch) && entry.pending === pending) {
          entry.pending = null;
          await this.updateStatus(sessionId, tenantId, 'FAILED');
        }
      });

    await pending.codeSent.promise;
    return { status: 'AWAITING_CODE' };
  }

  async submitLoginCode(input: SubmitLoginCodeInput): Promise<LoginStepResult> {
    const pending = this.requirePending(input.sessionId, 'code');
    if (pending.code.settled) throw new TelegramLoginNotPendingError(input.sessionId);
    return this.awaitStep(pending, () => pending.code.resolve(input.code));
  }

  async submitLoginPassword(input: SubmitLoginPasswordInput): Promise<LoginStepResult> {
    const entry = this.registry.get(input.sessionId);
    const pending = entry?.pending;
    if (!pending || pending.password.settled) throw new TelegramLoginNotPendingError(input.sessionId);
    return this.awaitStep(pending, () => pending.password.resolve(input.password));
  }

  private requirePending(sessionId: string, mode: PendingLogin['mode']): PendingLogin {
    const pending = this.registry.get(sessionId)?.pending;
    if (!pending || pending.mode !== mode) throw new TelegramLoginNotPendingError(sessionId);
    return pending;
  }

  /** Entrega o valor ao fluxo e espera o próximo passo: CONNECTED, AWAITING_PASSWORD ou erro. */
  private async awaitStep(pending: PendingLogin, deliver: () => void): Promise<LoginStepResult> {
    const waiter = new Deferred<{ status: SessionStatus }>();
    pending.waiter = waiter;
    deliver();
    // `flow` resolve só depois de `finishLogin`, que já resolveu o waiter com CONNECTED
    return Promise.race([waiter.promise, pending.flow.then(() => ({ status: 'CONNECTED' as SessionStatus }))]);
  }

  // ── Login por QR ───────────────────────────────────────────────────────────

  private startQrLogin(sessionId: string, entry: TelegramSessionEntry): void {
    const pending = this.newPending('qr');
    entry.pending = pending;
    const { tenantId } = entry;
    pending.flow = entry.client
      .signInUserWithQrCode(this.config, {
        qrCode: async ({ token }) => {
          if (!this.registry.isCurrent(sessionId, entry.epoch)) throw new Error('AUTH_USER_CANCEL');
          entry.latestQr = `tg://login?token=${token.toString('base64url')}`;
          await this.updateStatus(sessionId, tenantId, 'AWAITING_QR');
          internalEventBus.emit('SESSION_QR_UPDATED', { type: 'SESSION_QR_UPDATED', sessionId, tenantId, qrCode: entry.latestQr });
        },
        password: async () => {
          entry.latestQr = null;
          await this.updateStatus(sessionId, tenantId, 'AWAITING_PASSWORD');
          pending.password = new Deferred<string>();
          return pending.password.promise;
        },
        onError: async (err) => {
          if (isAuthCancel(err)) return true;
          const translated = translateTelegramLoginError(err);
          if (pending.waiter) {
            pending.waiter.reject(translated);
            pending.waiter = null;
            return false;
          }
          telegramLogger.warn({ err, sessionId }, 'Telegram QR login error');
          return false; // token expirado: a lib gera outro
        },
      })
      .then(() => this.finishLogin(sessionId, entry))
      .catch(async (err) => {
        pending.waiter?.reject(translateTelegramLoginError(err));
        pending.waiter = null;
        if (!isAuthCancel(err)) telegramLogger.warn({ err, sessionId }, 'Telegram QR login flow ended with error');
        if (this.registry.isCurrent(sessionId, entry.epoch) && entry.pending === pending) {
          entry.pending = null;
          entry.latestQr = null;
          await this.updateStatus(sessionId, tenantId, 'FAILED');
        }
      });
  }

  // ── Internos de conexão ────────────────────────────────────────────────────

  private newPending(mode: PendingLogin['mode']): PendingLogin {
    return {
      mode,
      codeSent: new Deferred<void>(),
      code: new Deferred<string>(),
      password: new Deferred<string>(),
      waiter: null,
      flow: Promise.resolve(),
    };
  }

  private async openClient(sessionId: string, tenantId: string, savedSession?: string | null): Promise<TelegramSessionEntry> {
    const existing = this.registry.get(sessionId);
    if (existing) await this.teardown(sessionId, existing);

    const saved = savedSession === undefined ? await this.auth.load(sessionId, tenantId) : savedSession;
    const client = new TelegramClient(new StringSession(saved ?? ''), this.config.apiId, this.config.apiHash, {
      connectionRetries: 5,
      autoReconnect: true,
      baseLogger: new Logger(LogLevel.ERROR),
      deviceModel: 'CopySync Web',
      appVersion: '1.0',
    });
    const entry: TelegramSessionEntry = {
      client,
      tenantId,
      epoch: this.registry.nextEpoch(),
      pending: null,
      latestQr: null,
      phone: null,
      sentIds: new Set(),
    };
    this.registry.set(sessionId, entry);
    await this.updateStatus(sessionId, tenantId, 'CONNECTING');
    internalEventBus.emit('SESSION_CONNECTING', { type: 'SESSION_CONNECTING', sessionId, tenantId });
    try {
      await client.connect();
    } catch (err) {
      this.registry.delete(sessionId);
      await this.updateStatus(sessionId, tenantId, 'FAILED');
      throw translateTelegramLoginError(err);
    }
    return entry;
  }

  private async finishLogin(sessionId: string, entry: TelegramSessionEntry): Promise<void> {
    if (!this.registry.isCurrent(sessionId, entry.epoch)) return;
    const { tenantId, client } = entry;
    const pending = entry.pending;
    entry.pending = null;
    entry.latestQr = null;

    await this.auth.save(sessionId, tenantId, client.session.save() as unknown as string);
    try {
      const me = await client.getMe();
      entry.phone = me.phone ? me.phone.replace(/\D/g, '') : null;
      if (entry.phone) await this.sessionRepo.updatePhone(sessionId, tenantId, entry.phone).catch(() => undefined);
    } catch (err) {
      telegramLogger.warn({ err, sessionId }, 'getMe failed after login');
    }
    client.addEventHandler((event: NewMessageEvent) => {
      void this.onNewMessage(sessionId, entry, event);
    }, new NewMessage({}));

    await this.sessionRepo
      .updateStatus(sessionId, tenantId, { status: 'CONNECTED', lastConnectedAt: new Date() })
      .catch(() => undefined);
    internalEventBus.emit('SESSION_CONNECTED', { type: 'SESSION_CONNECTED', sessionId, tenantId });
    telegramLogger.info({ sessionId, phone: entry.phone }, 'Telegram session connected');
    pending?.waiter?.resolve({ status: 'CONNECTED' });
    if (pending) pending.waiter = null;
  }

  private async teardown(sessionId: string, entry: TelegramSessionEntry): Promise<void> {
    if (this.registry.get(sessionId) === entry) this.registry.delete(sessionId);
    const pending = entry.pending;
    entry.pending = null;
    if (pending) {
      const cancel = new Error('AUTH_USER_CANCEL');
      if (!pending.code.settled) pending.code.reject(cancel);
      if (!pending.password.settled) pending.password.reject(cancel);
      if (!pending.codeSent.settled) pending.codeSent.reject(translateTelegramLoginError(cancel));
      pending.waiter?.reject(translateTelegramLoginError(cancel));
      pending.waiter = null;
    }
    try {
      await entry.client.destroy();
    } catch (err) {
      telegramLogger.debug({ err, sessionId }, 'Telegram client destroy failed');
    }
  }

  private async updateStatus(sessionId: string, tenantId: string, status: SessionStatus): Promise<void> {
    try {
      await this.sessionRepo.updateStatus(sessionId, tenantId, { status });
    } catch (err) {
      if (!(err instanceof SessionNotFoundError)) telegramLogger.warn({ err, sessionId, status }, 'Failed to update session status');
    }
  }

  private requireConnected(sessionId: string): TelegramSessionEntry {
    const entry = this.registry.get(sessionId);
    if (!entry || entry.pending || !entry.client.connected) throw new SessionNotConnectedError(sessionId);
    return entry;
  }

  // ── Recebimento ────────────────────────────────────────────────────────────

  private async onNewMessage(sessionId: string, entry: TelegramSessionEntry, event: NewMessageEvent): Promise<void> {
    if (!this.registry.isCurrent(sessionId, entry.epoch)) return;
    const msg = event.message;
    const externalMessageId = String(msg.id);
    const fromMe = Boolean(msg.out);
    if (fromMe && entry.sentIds.has(externalMessageId)) return; // eco do que acabamos de enviar

    const chatId = peerString(msg.peerId);
    if (!chatId) return;
    const isGroup = chatId.startsWith('-');
    const senderId = peerString(msg.fromId) ?? (fromMe ? entry.phone ?? 'me' : chatId);

    let chatName: string | undefined;
    let senderName: string | undefined;
    try {
      chatName = displayName(await event.getChat());
      if (isGroup) senderName = displayName(await msg.getSender());
      else senderName = chatName;
    } catch { /* nome é opcional */ }

    const msgType = mediaType(msg.media ?? undefined);
    const body = msg.message?.trim() ? msg.message : null;
    if (!body && msgType === 'text') return; // serviço/ação sem texto

    const quotedMessageId = msg.replyTo instanceof Api.MessageReplyHeader && msg.replyTo.replyToMsgId
      ? String(msg.replyTo.replyToMsgId)
      : null;

    internalEventBus.emit('MESSAGE_RECEIVED', {
      type: 'MESSAGE_RECEIVED',
      sessionId,
      tenantId: entry.tenantId,
      from: isGroup ? senderId : chatId,
      fromName: senderName,
      body,
      msgType,
      mediaUrl: null, // mídia do Telegram ainda não é baixada (docs/sessoes-telegram.md)
      mimeType: null,
      fileName: null,
      durationSeconds: null,
      isDeleted: false,
      quotedMessageId,
      fromMe,
      isGroup,
      groupJid: isGroup ? chatId : undefined,
      groupName: isGroup ? chatName : undefined,
      participant: isGroup ? senderId : undefined,
      participantName: isGroup ? senderName : undefined,
      externalMessageId,
      linkPreview: null,
    });
  }

  // ── Envio ──────────────────────────────────────────────────────────────────

  private async inputPeer(entry: TelegramSessionEntry, to: string) {
    const id = stripSuffix(to);
    return entry.client.getInputEntity(/^-?\d+$/.test(id) ? bigInt(id) : id);
  }

  async sendTextMessage(input: SendTextMessageInput): Promise<SendMessageResult> {
    const entry = this.requireConnected(input.sessionId);
    try {
      const peer = await this.inputPeer(entry, input.to);
      const replyTo = input.quotedMessage?.externalId && /^\d+$/.test(input.quotedMessage.externalId)
        ? Number(input.quotedMessage.externalId)
        : undefined;
      const sent = await entry.client.sendMessage(peer, {
        message: input.body,
        replyTo,
        linkPreview: input.linkPreview !== null,
      });
      const messageId = String(sent.id);
      this.registry.rememberSent(entry, messageId);
      internalEventBus.emit('MESSAGE_SENT', { type: 'MESSAGE_SENT', sessionId: input.sessionId, tenantId: input.tenantId, messageId });
      return { messageId, sentAt: new Date() };
    } catch (err) {
      if (isLoggedOutError(err)) void this.handleRevoked(input.sessionId, entry);
      throw translateTelegramSendError(err);
    }
  }

  /** O Telegram atribui o id no envio; este é um id provisório que o chat grava antes. */
  createOutboundMessageId(sessionId: string): string {
    this.requireConnected(sessionId);
    return `tg-${randomBytes(8).toString('hex')}`;
  }

  async sendMediaMessage(input: SendMediaMessageInput): Promise<SendMessageResult> {
    const entry = this.requireConnected(input.sessionId);
    const { media } = input;
    try {
      const peer = await this.inputPeer(entry, input.to);
      const sent = await entry.client.sendFile(peer, {
        file: media.filePath,
        caption: media.caption ?? undefined,
        forceDocument: media.kind === 'document',
        voiceNote: media.kind === 'voice',
        supportsStreaming: media.kind === 'video',
      });
      this.registry.rememberSent(entry, String(sent.id));
      internalEventBus.emit('MESSAGE_SENT', { type: 'MESSAGE_SENT', sessionId: input.sessionId, tenantId: input.tenantId, messageId: input.messageId });
      // Mantém o id pré-gerado: é o que o chat já persistiu
      return { messageId: input.messageId, sentAt: new Date() };
    } catch (err) {
      internalEventBus.emit('MESSAGE_FAILED', {
        type: 'MESSAGE_FAILED', sessionId: input.sessionId, tenantId: input.tenantId, messageId: input.messageId, reason: 'send_failed',
      });
      throw err instanceof MessageSendFailedError ? err : translateTelegramSendError(err);
    }
  }

  async sendReaction(input: SendReactionInput): Promise<SendMessageResult> {
    const entry = this.requireConnected(input.sessionId);
    try {
      const peer = await this.inputPeer(entry, input.target.remoteJid);
      await entry.client.invoke(new Api.messages.SendReaction({
        peer,
        msgId: Number(input.target.externalId),
        reaction: input.emoji ? [new Api.ReactionEmoji({ emoticon: input.emoji })] : [],
      }));
      return { messageId: input.target.externalId, sentAt: input.reactedAt };
    } catch (err) {
      throw translateTelegramSendError(err);
    }
  }

  async markMessagesRead(input: MarkMessagesReadInput): Promise<void> {
    const entry = this.requireConnected(input.sessionId);
    const maxId = Math.max(...input.messageIds.map(Number).filter(Number.isFinite), 0);
    try {
      const peer = await this.inputPeer(entry, input.remoteJid);
      await entry.client.markAsRead(peer, maxId || undefined);
    } catch (err) {
      telegramLogger.debug({ err, sessionId: input.sessionId }, 'markAsRead failed');
    }
  }

  async presenceSubscribe(): Promise<void> {
    // Telegram entrega presença junto das atualizações; nada a assinar
  }

  async sendPresence(sessionId: string, to: string, presence: 'composing' | 'paused'): Promise<void> {
    const entry = this.requireConnected(sessionId);
    try {
      const peer = await this.inputPeer(entry, to);
      await entry.client.invoke(new Api.messages.SetTyping({
        peer,
        action: presence === 'composing' ? new Api.SendMessageTypingAction() : new Api.SendMessageCancelAction(),
      }));
    } catch (err) {
      telegramLogger.debug({ err, sessionId }, 'setTyping failed');
    }
  }

  // ── Grupos ─────────────────────────────────────────────────────────────────

  async listParticipatingGroups(sessionId: string): Promise<ParticipatingGroupInfo[]> {
    const entry = this.requireConnected(sessionId);
    const dialogs = await entry.client.getDialogs({ limit: 500 });
    const out: ParticipatingGroupInfo[] = [];
    for (const d of dialogs) {
      if (!d.isGroup && !d.isChannel) continue;
      const ent = d.entity as Api.Channel | Api.Chat | undefined;
      // Canal (broadcast) só entra se a conta pode postar nele
      if (ent instanceof Api.Channel && ent.broadcast && !(ent.creator || ent.adminRights?.postMessages)) continue;
      if (ent instanceof Api.Chat && (ent.left || ent.deactivated)) continue;
      if (ent instanceof Api.Channel && ent.left) continue;
      if (!d.id) continue;
      out.push({ groupJid: d.id.toString(), name: d.title ?? null });
    }
    return out;
  }

  async getGroupInviteLink(sessionId: string, groupJid: string): Promise<{ inviteCode: string }> {
    const entry = this.requireConnected(sessionId);
    try {
      const peer = await this.inputPeer(entry, groupJid);
      const res = await entry.client.invoke(new Api.messages.ExportChatInvite({ peer }));
      const link = res instanceof Api.ChatInviteExported ? res.link : '';
      // Link do Telegram é `https://t.me/+<code>`; devolve só o código (quem monta a URL sabe o canal)
      return { inviteCode: link.replace(/^https?:\/\/t\.me\//, '') };
    } catch (err) {
      throw translateTelegramSendError(err);
    }
  }

  async getGroupSummary(sessionId: string, groupJid: string): Promise<{ name: string; memberCount: number; isSelfAdmin: boolean }> {
    const entry = this.requireConnected(sessionId);
    const ent = await entry.client.getEntity(await this.inputPeer(entry, groupJid));
    if (ent instanceof Api.Channel) {
      const full = await entry.client.invoke(new Api.channels.GetFullChannel({ channel: ent }));
      const count = full.fullChat instanceof Api.ChannelFull ? full.fullChat.participantsCount ?? 0 : 0;
      return { name: ent.title, memberCount: count, isSelfAdmin: Boolean(ent.creator || ent.adminRights) };
    }
    if (ent instanceof Api.Chat) {
      return { name: ent.title, memberCount: ent.participantsCount, isSelfAdmin: Boolean(ent.creator || ent.adminRights) };
    }
    throw new EngineOperationUnsupportedError(ENGINE, 'getGroupSummary:not-a-group');
  }

  async getGroupParticipants(sessionId: string, groupJid: string): Promise<GroupParticipantInfo[]> {
    const entry = this.requireConnected(sessionId);
    const peer = await this.inputPeer(entry, groupJid);
    const users = await entry.client.getParticipants(peer, { limit: 200 });
    return users.map((u) => ({
      jid: u.id.toString(),
      phone: u.phone ? u.phone.replace(/\D/g, '') : null,
      name: displayName(u) ?? null,
      avatarUrl: null,
      isAdmin: false, // papel exige GetParticipant por usuário; fica para quando for usado
    }));
  }

  async fetchProfilePicture(): Promise<string | null> {
    return null; // foto de perfil do Telegram: etapa futura (precisa do media store)
  }

  async checkNumberExists(): Promise<boolean | null> {
    return null;
  }

  async updateChatState(input: UpdateChatStateInput): Promise<void> {
    telegramLogger.debug({ sessionId: input.sessionId }, 'updateChatState ignored for Telegram');
  }

  private async handleRevoked(sessionId: string, entry: TelegramSessionEntry): Promise<void> {
    telegramLogger.warn({ sessionId }, 'Telegram revoked the session — clearing credentials');
    await this.teardown(sessionId, entry);
    await this.auth.clear(sessionId);
    await this.updateStatus(sessionId, entry.tenantId, 'LOGGED_OUT');
    internalEventBus.emit('SESSION_LOGGED_OUT', { type: 'SESSION_LOGGED_OUT', sessionId, tenantId: entry.tenantId });
  }

  /** Encerra todos os clientes (shutdown do processo). */
  async shutdown(): Promise<void> {
    await Promise.all(this.registry.all().map(([id, entry]) => this.teardown(id, entry)));
  }
}
