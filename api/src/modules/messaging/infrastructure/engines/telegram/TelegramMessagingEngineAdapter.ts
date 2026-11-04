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
 * Mensagens: id externo `<peerId>_<msgId>` (`telegramMessageId.ts`); `msgType` no enum do chat
 * (`ChatMessageType`, igual ao Baileys); texto/legenda no formato do WhatsApp convertido para HTML
 * do Telegram (`whatsappToTelegramHtml.ts`). Detalhes em docs/sessoes-telegram.md §5.
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
import type { IChatConversationRepository } from '../../../../chat/domain/contracts/IChatConversationRepository';
import { ChatMessageType } from '../../../../chat/domain/enums/ChatMessageEnums';
import { mimeTypeToExt } from '../../../../../shared/storage/mediaFileExtension';
import { SessionNotConnectedError, SessionNotFoundError } from '../../../../../shared/errors/internal/SessionErrors';
import { EngineOperationUnsupportedError, MessageSendFailedError } from '../../../../../shared/errors/internal/MessagingErrors';
import { TelegramLoginNotPendingError } from '../../../../../shared/errors/internal/TelegramErrors';
import { TelegramSessionRegistry, type PendingLogin, type TelegramSessionEntry } from './TelegramSessionRegistry';
import type { TelegramAuthStatePersistence } from './TelegramAuthStatePersistence';
import { Deferred } from './deferred';
import { mediaContainer } from '../../../../media/infrastructure/mediaContainer';
import { isAuthCancel, isLoggedOutError, translateTelegramLoginError, translateTelegramSendError } from './TelegramErrorTranslator';
import { composeTelegramMessageId, parseTelegramMessageId } from './telegramMessageId';
import { whatsappToTelegramHtml } from './whatsappToTelegramHtml';

const telegramLogger = appLogger.child({ module: 'TelegramEngine' });
const ENGINE = 'telegram';
/** Foto baixada e servida pelo nosso storage; revalida a cada 6 h (como no WhatsApp). */
const PROFILE_PICTURE_TTL_MS = 6 * 60 * 60 * 1_000;
/** Quanto a listagem de grupos espera pelas fotos que ainda faltam baixar. */
const GROUP_AVATAR_WAIT_MS = 3_000;
/** Mídia recebida acima disso não é baixada (vídeo/arquivo grande): a mensagem entra sem `mediaUrl`. */
export const TELEGRAM_INBOUND_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
const PARSE_MODE = 'html';

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

/** Peer marcado do destino já resolvido: é o mesmo que `msg.peerId` traz no eco (id composto). */
function sentPeerId(peer: Api.TypeInputPeer, to: string): string {
  try {
    return getPeerId(peer, true);
  } catch {
    return stripSuffix(to);
  }
}

function displayName(entity: unknown): string | undefined {
  const e = entity as { firstName?: string; lastName?: string; username?: string; title?: string } | undefined;
  if (!e) return undefined;
  if (e.title) return e.title;
  const name = [e.firstName, e.lastName].filter(Boolean).join(' ').trim();
  return name || e.username || undefined;
}

/** Tipo no mesmo enum que o Baileys emite (`ChatMessageType`): captura e chat comparam por ele. */
export function mediaType(media: Api.TypeMessageMedia | undefined): ChatMessageType {
  if (!media) return ChatMessageType.TEXT;
  if (media instanceof Api.MessageMediaPhoto) return ChatMessageType.IMAGE;
  if (media instanceof Api.MessageMediaDocument) {
    const doc = media.document instanceof Api.Document ? media.document : null;
    const mime = doc?.mimeType ?? '';
    const attrs = doc?.attributes ?? [];
    if (attrs.some((a) => a instanceof Api.DocumentAttributeSticker)) return ChatMessageType.STICKER;
    if (attrs.some((a) => a instanceof Api.DocumentAttributeAudio && a.voice)) return ChatMessageType.AUDIO;
    if (mime.startsWith('video/')) return ChatMessageType.VIDEO;
    if (mime.startsWith('image/')) return ChatMessageType.IMAGE;
    if (mime.startsWith('audio/')) return ChatMessageType.AUDIO;
    return ChatMessageType.DOCUMENT;
  }
  return ChatMessageType.TEXT; // prévia de link (MessageMediaWebPage) e o resto: texto
}

/** Metadados da mídia recebida: MIME, nome, duração e tamanho (para o limite de download). */
function mediaInfo(media: Api.TypeMessageMedia | undefined): { mimeType: string | null; fileName: string | null; durationSeconds: number | null; size: number | null } {
  if (media instanceof Api.MessageMediaPhoto) {
    const photo = media.photo instanceof Api.Photo ? media.photo : null;
    let size = 0;
    for (const s of photo?.sizes ?? []) {
      if (s instanceof Api.PhotoSize) size = Math.max(size, s.size);
      else if (s instanceof Api.PhotoSizeProgressive) size = Math.max(size, ...s.sizes);
    }
    return { mimeType: 'image/jpeg', fileName: null, durationSeconds: null, size: size || null };
  }
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    const doc = media.document;
    let fileName: string | null = null;
    let duration: number | null = null;
    for (const a of doc.attributes) {
      if (a instanceof Api.DocumentAttributeFilename) fileName = a.fileName;
      else if (a instanceof Api.DocumentAttributeVideo || a instanceof Api.DocumentAttributeAudio) duration = Math.round(a.duration);
    }
    return { mimeType: doc.mimeType || null, fileName, durationSeconds: duration, size: Number(doc.size.toString()) };
  }
  return { mimeType: null, fileName: null, durationSeconds: null, size: null };
}

export class TelegramMessagingEngineAdapter implements IMessagingEngine {
  private readonly registry = new TelegramSessionRegistry();
  private readonly profilePictureCache = new Map<string, { url: string | null; at: number }>();
  /** Fotos de grupo já no storage (nome inclui o photoId: foto nova = arquivo novo). */
  private readonly knownGroupAvatars = new Set<string>();
  /** Downloads de foto de grupo em andamento, por arquivo (sem repetir o mesmo). */
  private readonly groupAvatarJobs = new Map<string, Promise<string | null>>();
  /** Fila única: um download por vez, para não provocar FLOOD_WAIT na listagem. */
  private groupAvatarQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly config: TelegramEngineConfig,
    private readonly sessionRepo: ISessionRepository,
    private readonly auth: TelegramAuthStatePersistence,
    /** Regra de download de mídia em grupo (`autoDownloadMedia` da conversa), a mesma do Baileys. */
    private readonly chatConversationRepo: Pick<IChatConversationRepository, 'findActiveByGroupAndSession'>,
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
    const chatId = peerString(msg.peerId);
    if (!chatId) return;
    const externalMessageId = composeTelegramMessageId(chatId, msg.id);
    const fromMe = Boolean(msg.out);
    if (fromMe && entry.sentIds.has(externalMessageId)) return; // eco do que acabamos de enviar

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
    if (!body && msgType === ChatMessageType.TEXT) return; // serviço/ação sem texto

    const reply = msg.replyTo instanceof Api.MessageReplyHeader ? msg.replyTo : null;
    const quotedMessageId = reply?.replyToMsgId
      ? composeTelegramMessageId(peerString(reply.replyToPeerId) ?? chatId, reply.replyToMsgId)
      : null;

    const info = mediaInfo(msg.media ?? undefined);
    const mediaUrl = msgType !== ChatMessageType.TEXT && await this.shouldDownloadMedia(sessionId, entry.tenantId, isGroup ? chatId : null)
      ? await this.downloadInboundMedia(sessionId, entry, msg, externalMessageId, info)
      : null;

    internalEventBus.emit('MESSAGE_RECEIVED', {
      type: 'MESSAGE_RECEIVED',
      sessionId,
      tenantId: entry.tenantId,
      from: isGroup ? senderId : chatId,
      fromName: senderName,
      body,
      msgType,
      mediaUrl,
      mimeType: info.mimeType,
      fileName: info.fileName,
      durationSeconds: info.durationSeconds,
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

  /** Contato: sempre; grupo: só com `autoDownloadMedia` na conversa (monitorados ligam). Igual ao Baileys. */
  private async shouldDownloadMedia(sessionId: string, tenantId: string, groupJid: string | null): Promise<boolean> {
    if (!groupJid) return true;
    try {
      const conv = await this.chatConversationRepo.findActiveByGroupAndSession(groupJid, sessionId, tenantId);
      return conv?.autoDownloadMedia ?? false;
    } catch (err) {
      telegramLogger.warn({ err, sessionId }, 'Failed to read autoDownloadMedia; skipping Telegram media download');
      return false;
    }
  }

  /**
   * Baixa a mídia recebida (foto no maior tamanho; documento/vídeo/áudio até o limite) para o
   * `mediaFileStore`. Falha ou acima do limite → `null`: a mensagem entra sem mídia.
   */
  private async downloadInboundMedia(
    sessionId: string,
    entry: TelegramSessionEntry,
    msg: Api.Message,
    externalMessageId: string,
    info: { mimeType: string | null; size: number | null },
  ): Promise<string | null> {
    if (info.size !== null && info.size > TELEGRAM_INBOUND_MEDIA_MAX_BYTES) {
      telegramLogger.info({ sessionId, size: info.size }, 'Telegram media above download limit; persisted without mediaUrl');
      return null;
    }
    const store = mediaContainer.mediaFileStore;
    const filename = `${sessionId}_tg_${externalMessageId.replace(/[^0-9A-Za-z_]/g, 'n')}.${mimeTypeToExt(info.mimeType)}`;
    try {
      if (await store.mediaExists(filename)) return store.publicUrl(filename);
      const buf = await entry.client.downloadMedia(msg, {});
      if (!Buffer.isBuffer(buf) || buf.length === 0 || buf.length > TELEGRAM_INBOUND_MEDIA_MAX_BYTES) return null;
      return await store.saveBuffer(buf, filename);
    } catch (err) {
      telegramLogger.warn({ err, sessionId }, 'Failed to download Telegram media; message will be persisted without mediaUrl');
      return null;
    }
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
      // Prévia nativa do Telegram (1º link do texto) só quando quem chama pediu prévia, como no
      // WhatsApp; a miniatura montada por nós não é usada aqui. Menções são ignoradas no Telegram.
      const sent = await entry.client.sendMessage(peer, {
        message: whatsappToTelegramHtml(input.body),
        parseMode: PARSE_MODE,
        replyTo: this.replyToId(input.quotedMessage?.externalId),
        linkPreview: Boolean(input.linkPreview),
      });
      const messageId = composeTelegramMessageId(sentPeerId(peer, input.to), sent.id);
      this.registry.rememberSent(entry, messageId);
      internalEventBus.emit('MESSAGE_SENT', { type: 'MESSAGE_SENT', sessionId: input.sessionId, tenantId: input.tenantId, messageId });
      return { messageId, sentAt: new Date() };
    } catch (err) {
      if (isLoggedOutError(err)) void this.handleRevoked(input.sessionId, entry);
      throw translateTelegramSendError(err);
    }
  }

  /** `msg.id` do Telegram a citar; id provisório (`tg-…`) ou de outro formato → sem citação. */
  private replyToId(externalId: string | null | undefined): number | undefined {
    return parseTelegramMessageId(externalId)?.msgId;
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
        caption: media.caption ? whatsappToTelegramHtml(media.caption) : undefined,
        parseMode: PARSE_MODE,
        replyTo: this.replyToId(input.quotedMessage?.externalId),
        forceDocument: media.kind === 'document',
        voiceNote: media.kind === 'voice',
        supportsStreaming: media.kind === 'video',
      });
      const messageId = composeTelegramMessageId(sentPeerId(peer, input.to), sent.id);
      // Eco descartado por sentIds: o chat troca o provisório (`tg-…`) por este id ao gravar SENT
      this.registry.rememberSent(entry, messageId);
      internalEventBus.emit('MESSAGE_SENT', { type: 'MESSAGE_SENT', sessionId: input.sessionId, tenantId: input.tenantId, messageId: input.messageId });
      return { messageId, sentAt: new Date() };
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
      const target = parseTelegramMessageId(input.target.externalId);
      if (!target) throw new MessageSendFailedError('telegram: reaction target has no Telegram message id');
      const peer = await this.inputPeer(entry, input.target.remoteJid);
      await entry.client.invoke(new Api.messages.SendReaction({
        peer,
        msgId: target.msgId,
        reaction: input.emoji ? [new Api.ReactionEmoji({ emoticon: input.emoji })] : [],
      }));
      return { messageId: input.target.externalId, sentAt: input.reactedAt };
    } catch (err) {
      throw translateTelegramSendError(err);
    }
  }

  async markMessagesRead(input: MarkMessagesReadInput): Promise<void> {
    const entry = this.requireConnected(input.sessionId);
    const maxId = Math.max(...input.messageIds.map((id) => parseTelegramMessageId(id)?.msgId ?? 0), 0);
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
    const avatarOf = new Map<number, Promise<string | null>>();
    for (const d of dialogs) {
      if (!d.isGroup && !d.isChannel) continue;
      const ent = d.entity as Api.Channel | Api.Chat | undefined;
      // Canal (broadcast) só entra se a conta pode postar nele
      if (ent instanceof Api.Channel && ent.broadcast && !(ent.creator || ent.adminRights?.postMessages)) continue;
      if (ent instanceof Api.Chat && (ent.left || ent.deactivated)) continue;
      if (ent instanceof Api.Channel && ent.left) continue;
      if (!d.id) continue;
      out.push({ groupJid: d.id.toString(), name: d.title ?? null, avatarUrl: null });
      avatarOf.set(out.length - 1, this.groupAvatar(sessionId, entry, d.id.toString(), ent));
    }
    // Fotos que já estão no storage voltam agora; as que faltam baixam em fila e, se terminarem
    // dentro do prazo, entram nesta resposta — senão na próxima (e na conversa, via evento).
    const filled = [...avatarOf].map(([i, p]) => p.then((url) => { out[i]!.avatarUrl = url; }));
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all(filled),
      new Promise<void>((r) => { timer = setTimeout(r, GROUP_AVATAR_WAIT_MS); }),
    ]);
    clearTimeout(timer);
    return out.map((g) => ({ ...g }));
  }

  /** URL da foto do grupo no storage; agenda o download quando ainda não foi salva. */
  private async groupAvatar(sessionId: string, entry: TelegramSessionEntry, groupJid: string, ent: unknown): Promise<string | null> {
    const photo = (ent as { photo?: unknown } | undefined)?.photo;
    if (!(photo instanceof Api.ChatPhoto)) return null;
    const store = mediaContainer.mediaFileStore;
    const filename = `avatar_tg_${groupJid.replace('-', 'n')}_${photo.photoId.toString()}.jpg`;
    if (this.knownGroupAvatars.has(filename)) return store.publicUrl(filename);
    if (await store.mediaExists(filename).catch(() => false)) {
      this.knownGroupAvatars.add(filename);
      return store.publicUrl(filename);
    }
    const running = this.groupAvatarJobs.get(filename);
    if (running) return running;
    const job = this.groupAvatarQueue.then(async () => {
      try {
        const buf = await entry.client.downloadProfilePhoto(ent as Api.Chat, { isBig: false });
        if (!Buffer.isBuffer(buf) || buf.length === 0) return null;
        const url = await store.saveBuffer(buf, filename);
        this.knownGroupAvatars.add(filename);
        internalEventBus.emit('GROUP_AVATAR_UPDATED', { type: 'GROUP_AVATAR_UPDATED', tenantId: entry.tenantId, groupJid, avatarUrl: url });
        return url;
      } catch (err) {
        telegramLogger.debug({ err, sessionId }, 'Failed to download Telegram group photo');
        return null;
      } finally {
        this.groupAvatarJobs.delete(filename);
      }
    });
    this.groupAvatarQueue = job.catch(() => undefined);
    this.groupAvatarJobs.set(filename, job);
    return job;
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

  /**
   * Foto de perfil: da própria conta (quando `jid` é o telefone da sessão), de grupo/canal ou de
   * contato (peer id marcado). Baixada do Telegram e salva no storage, que serve a URL pública.
   */
  async fetchProfilePicture(sessionId: string, jid: string, isGroup: boolean): Promise<string | null> {
    const entry = this.registry.get(sessionId);
    if (!entry || entry.pending) return null;
    const id = stripSuffix(jid);
    const isSelf = !isGroup && (id === 'me' || (entry.phone !== null && id.replace(/\D/g, '') === entry.phone));
    const cacheKey = `${sessionId}:${isSelf ? 'me' : id}`;
    const cached = this.profilePictureCache.get(cacheKey);
    if (cached && Date.now() - cached.at < PROFILE_PICTURE_TTL_MS) return cached.url;

    try {
      const entity = isSelf ? await entry.client.getMe() : await entry.client.getEntity(await this.inputPeer(entry, id));
      const photo = await entry.client.downloadProfilePhoto(entity, { isBig: false });
      if (!Buffer.isBuffer(photo) || photo.length === 0) {
        this.profilePictureCache.set(cacheKey, { url: null, at: Date.now() });
        return null;
      }
      const key = isSelf ? `me_${sessionId}` : id.replace('-', 'n');
      const url = await mediaContainer.mediaFileStore.saveBuffer(photo, `avatar_tg_${key}.jpg`);
      this.profilePictureCache.set(cacheKey, { url, at: Date.now() });
      return url;
    } catch (err) {
      telegramLogger.debug({ err, sessionId, isGroup }, 'Failed to fetch Telegram profile picture');
      return null;
    }
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
