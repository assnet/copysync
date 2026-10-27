/**
 * BaileysMessagingEngineAdapter
 *
 * Concrete implementation of IMessagingEngine backed by @whiskeysockets/baileys.
 *
 * ONLY this file (and BaileysAuthStatePersistence / BaileysErrorTranslator) may
 * import from @whiskeysockets/baileys.  All output must be translated to internal
 * types before leaving this file.
 */
import makeWASocket, {
  Browsers,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import type { ConnectionState, AnyMessageContent, WASocket, WAMessage, proto } from '@whiskeysockets/baileys';
import { mediaContainer } from '../../../../media/infrastructure/mediaContainer';
import { mimeTypeToExt } from '../../../../../shared/storage/mediaFileExtension';
import { logger as appLogger } from '../../../../../shared/logger/logger';
import { env } from '../../../../../shared/config/env';
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
  SendTextMessageInput,
  QuotedMessageRef,
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
import type { ISessionAuthStateRepository } from '../../../../sessions/domain/contracts/ISessionAuthStateRepository';
import { buildBaileysAuthState } from './BaileysAuthStatePersistence';
import { BaileysSessionRegistry } from './BaileysSessionRegistry';
import {
  translateDisconnect,
  translateEngineError,
  translatePairingError,
  translateSendError,
} from './BaileysErrorTranslator';
import { normalizeChatState, isEmptyChatState, type RawChatState, type ChatStateSource } from './normalizeChatState';
import type { RemoteChatState } from '../../../../../shared/events/InternalMessagingEvent';
import { outboundEchoRegistries } from './outboundEchoRegistries';
import { sentMediaCache } from './sentMediaCache';
import { isOwnOutboundEcho } from './isOwnOutboundEcho';
import { normalizeReactionEvent } from './normalizeReactionEvent';
import { buildBaileysQuotedMessage } from './buildBaileysQuotedMessage';
import { buildBaileysMediaContent } from './buildBaileysMediaContent';
import { MessageSendFailedError } from '../../../../../shared/errors/internal/MessagingErrors';
import { MediaTooLargeError } from '../../../../../shared/errors/internal/MediaErrors';
import {
  SessionNotFoundError,
  SessionNotConnectedError,
  SessionAlreadyConnectedError,
} from '../../../../../shared/errors/internal/SessionErrors';
import type { IChatContactRepository } from '../../../../chat/domain/contracts/IChatContactRepository';
import type { IChatConversationRepository } from '../../../../chat/domain/contracts/IChatConversationRepository';
import type { IngestHistorySyncUseCase, HistoryMessageItem } from '../../../../chat/application/use-cases/IngestHistorySyncUseCase';
import { ChatMessageType } from '../../../../chat/domain/enums/ChatMessageEnums';

/** Every socket event this adapter subscribes to — detached when a socket is replaced. */
const HANDLED_SOCKET_EVENTS = [
  'creds.update',
  'connection.update',
  'messages.upsert',
  'messages.update',
  'messages.reaction',
  'messaging-history.set',
  'contacts.upsert',
  'presence.update',
  'chats.upsert',
  'chats.update',
] as const;

/** Máximo de fotos de perfil buscadas ao listar participantes de um grupo. */
const GROUP_AVATAR_FETCH_LIMIT = 200;
/** Consultas de foto em paralelo — o WhatsApp responde mal a rajadas maiores. */
const GROUP_AVATAR_CONCURRENCY = 8;
/** Validade do cache de fotos de participante. A URL do WhatsApp é temporária. */
const PROFILE_PICTURE_TTL_MS = 6 * 60 * 60 * 1_000;
const PARTICIPATING_GROUPS_TTL_MS = 60_000;
/** Tempo de vida de cada QR de pareamento. */
const QR_TIMEOUT_MS = 120_000;
/** Tempo máximo para descobrir o LID do autor citado; estourou, a citação sai pelo número. */
const QUOTE_AUTHOR_LOOKUP_TIMEOUT_MS = 3_000;

/** Resolve `null` se a promessa não terminar no prazo (a original segue e é descartada). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Menor limite de upload anunciado pelos servidores de mídia (`media_conn`), ou `null` sem
 * limite conhecido. Atributo ausente vira `NaN` na lib e é ignorado; zero não é limite real.
 */
function mediaUploadLimitBytes(limits: number[]): number | null {
  const known = limits.filter((value) => Number.isFinite(value) && value > 0);
  return known.length ? Math.min(...known) : null;
}

const RECONNECT_MAX_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 3_000;
const THIRTY_MIN_MS = 30 * 60 * 1_000;
const baileysLogger = appLogger.child({ module: 'baileys' });

export class BaileysMessagingEngineAdapter implements IMessagingEngine {
  private readonly registry = BaileysSessionRegistry.get();
  private readonly groupMetadataCache = new Map<string, GroupMetadataSnapshot>();
  private readonly groupMetadataPending = new Map<string, Promise<GroupMetadataSnapshot | null>>();
  /**
   * Sessions whose socket was reopened right after wiping revoked credentials.
   * Guards against an endless wipe/reopen loop; cleared once the session connects.
   */
  private readonly pairingRestarts = new Set<string>();
  /**
   * Sessões em modo "conectar com código": número a parear, mantido entre reconexões até
   * a sessão abrir, voltar ao QR (connectSession) ou ser desconectada. Efêmero como o
   * socket — perder no restart só obriga o operador a pedir o código de novo.
   */
  private readonly pairingPhones = new Map<string, string>();
  /** Pedido de código em andamento por sessão: mesmo número reaproveita a promise (sem pedido duplicado). */
  private readonly pairingInFlight = new Map<string, { phone: string; promise: Promise<string> }>();
  /** Cache de fotos por JID: evita repetir a consulta a cada abertura do painel. */
  private readonly profilePictureCache = new Map<string, { url: string | null; at: number }>();
  /** Lista de grupos por sessão: a consulta ao WhatsApp é pesada e a busca do painel repete. */
  private readonly participatingGroupsCache = new Map<string, { groups: ParticipatingGroupInfo[]; at: number }>();
  /** Sessões que estão "disponíveis" só para mostrar "digitando…" (ver sendPresence). */
  private readonly typingOnline = new Set<string>();

  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly authStateRepo: ISessionAuthStateRepository,
    private readonly chatContactRepo: IChatContactRepository,
    private readonly chatConversationRepo: IChatConversationRepository,
    private readonly historySyncUseCase: IngestHistorySyncUseCase,
  ) {}

  async createSession(input: CreateSessionInput): Promise<void> {
    internalEventBus.emit('SESSION_CREATED', {
      type: 'SESSION_CREATED',
      sessionId: input.sessionId,
      tenantId: input.tenantId,
    });
  }

  async connectSession(input: ConnectSessionInput): Promise<ConnectSessionResult> {
    const { sessionId, tenantId } = input;
    // A user-initiated connect starts a fresh recovery cycle — in QR mode.
    this.pairingRestarts.delete(sessionId);
    this.pairingPhones.delete(sessionId);
    const existing = this.registry.get(sessionId);
    if (existing) {
      // Detach before ending: the old socket still emits 'close' asynchronously and
      // that handler would otherwise tear down the socket we are about to create.
      this.detachSocket(existing.socket);
      try { existing.socket.end(undefined); } catch { /* best-effort */ }
      this.registry.delete(sessionId);
    }
    await this.openSocket(sessionId, tenantId, 0);
    return {};
  }

  async disconnectSession(input: DisconnectSessionInput): Promise<void> {
    const { sessionId, tenantId } = input;
    this.pairingRestarts.delete(sessionId);
    this.pairingPhones.delete(sessionId);
    const entry = this.registry.get(sessionId);
    if (entry) {
      this.detachSocket(entry.socket);
      try { entry.socket.end(undefined); } catch (err) {
        baileysLogger.warn({ err, sessionId }, 'Error closing socket on disconnect');
      }
      this.registry.delete(sessionId);
    }
    this.clearSessionGroupMetadata(sessionId);
    await this.updateSessionStatus(sessionId, tenantId, 'DISCONNECTED');
  }

  async reconnectSession(input: ReconnectSessionInput): Promise<void> {
    await this.connectSession({ sessionId: input.sessionId, tenantId: input.tenantId });
  }

  async logoutSession(input: LogoutSessionInput): Promise<void> {
    const { sessionId, tenantId } = input;
    this.pairingRestarts.delete(sessionId);
    this.pairingPhones.delete(sessionId);
    const entry = this.registry.get(sessionId);
    if (entry) {
      try { await entry.socket.logout(); } catch (err) {
        baileysLogger.warn({ err, sessionId }, 'Error during Baileys logout');
      }
      this.detachSocket(entry.socket);
      entry.socket.end(undefined);
      this.registry.delete(sessionId);
    }
    this.clearSessionGroupMetadata(sessionId);
    await this.updateSessionStatus(sessionId, tenantId, 'LOGGED_OUT');
    internalEventBus.emit('SESSION_LOGGED_OUT', { type: 'SESSION_LOGGED_OUT', sessionId, tenantId });
  }

  async getSessionStatus(sessionId: string): Promise<SessionStatus> {
    const entry = this.registry.get(sessionId);
    if (!entry) return 'DISCONNECTED';
    const ws = entry.socket.ws as { readyState?: number } | undefined;
    if (ws?.readyState === 1) return 'CONNECTED';
    if (ws?.readyState === 0) return 'CONNECTING';
    return 'DISCONNECTED';
  }

  async getSessionQr(sessionId: string): Promise<string | null> {
    return this.registry.getQr(sessionId) ?? null;
  }

  async getSessionPairingCode(sessionId: string): Promise<string | null> {
    return this.registry.getPairingCode(sessionId) ?? null;
  }

  async requestPairingCode(input: RequestPairingCodeInput): Promise<RequestPairingCodeResult> {
    const { sessionId, tenantId, phone } = input;
    const entry = this.registry.get(sessionId);
    if (entry?.socket.authState.creds.registered) throw new SessionAlreadyConnectedError(sessionId);

    this.pairingPhones.set(sessionId, phone);

    if (entry && this.registry.getQr(sessionId)) {
      // Socket já aceito pelo WhatsApp (emitiu QR): o código pode ser pedido agora.
      try {
        const pairingCode = await this.issuePairingCode(sessionId, tenantId, phone);
        return { pairingCode };
      } catch (err) {
        // Falhou: volta ao QR; rotações seguintes não repetem o pedido
        if (this.pairingPhones.get(sessionId) === phone) this.pairingPhones.delete(sessionId);
        throw err;
      }
    }

    if (!entry) {
      this.pairingRestarts.delete(sessionId);
      try {
        await this.openSocket(sessionId, tenantId, 0);
      } catch (err) {
        this.pairingPhones.delete(sessionId);
        throw translatePairingError(err);
      }
    }
    // Socket subindo: o primeiro QR do connection.update dispara o pedido do código.
    return { pairingCode: null };
  }

  async sendTextMessage(input: SendTextMessageInput): Promise<SendMessageResult> {
    const entry = this.requireConnectedEntry(input.sessionId);
    try {
      const jid = this.normalizeJid(input.to);
      const quoted = await this.buildQuoted(entry.socket, entry.tenantId, input.quotedMessage, jid, input.sessionId);
      const mentions = input.mentions?.length ? input.mentions.map((phone) => this.normalizeJid(phone)) : undefined;
      const result = await entry.socket.sendMessage(
        jid,
        { text: input.body, ...(mentions ? { mentions } : {}) },
        quoted ? { quoted } : undefined,
      );
      return { messageId: result?.key?.id ?? crypto.randomUUID(), sentAt: new Date() };
    } catch (err) { throw translateEngineError(err); }
  }

  createOutboundMessageId(sessionId: string): string {
    const entry = this.registry.get(sessionId);
    if (!entry || !entry.socket.user || !entry.socket.ws.isOpen) {
      throw new SessionNotConnectedError(sessionId);
    }
    return generateMessageIDV2(entry.socket.user.id);
  }

  async sendMediaMessage(input: SendMediaMessageInput): Promise<SendMessageResult> {
    const { sessionId, messageId, media } = input;
    // Sem caminho nem legenda no log: só o que identifica o envio.
    const log = { sessionId, messageId, kind: media.kind, mimeType: media.mimeType, sizeBytes: media.sizeBytes };

    // Pré-condições antes do socket (as mesmas da reação): falha rápida, sem envio parcial.
    const entry = this.registry.get(sessionId);
    if (!entry || !entry.socket.user || !entry.socket.ws.isOpen) {
      throw new SessionNotConnectedError(sessionId);
    }
    const jid = this.normalizeJid(input.to);

    try {
      // Limite anunciado pelos servidores de mídia: acima dele o upload falharia depois de subir
      // o arquivo inteiro. Checado antes para falhar sem gastar banda.
      const { hosts } = await entry.socket.refreshMediaConn(false);
      const maxBytes = mediaUploadLimitBytes(hosts.map((h) => h.maxContentLengthBytes));
      if (maxBytes !== null && media.sizeBytes > maxBytes) {
        baileysLogger.info({ ...log, maxBytes }, 'Media above engine upload limit — not sent');
        throw new MediaTooLargeError('Media exceeds the messaging engine upload limit', {
          sizeBytes: media.sizeBytes,
          maxBytes,
        });
      }
      baileysLogger.info({ ...log, maxBytes }, 'Media send started');

      const quoted = await this.buildQuoted(entry.socket, entry.tenantId, input.quotedMessage, jid, sessionId);
      // Mesma conversão do texto: telefone → JID
      const mentions = input.mentions?.length ? input.mentions.map((phone) => this.normalizeJid(phone)) : undefined;

      // Registro de eco ANTES do envio: o eco sai de dentro do sendMessage, depois do upload.
      // Falha não retira o id — o eco tardio de um timeout ainda precisa da marca. Registro de
      // módulo: o eco chega no handler do adapter que abriu o socket, que pode ser outro.
      outboundEchoRegistries().media.register(sessionId, messageId);

      const startedAt = Date.now();
      const result = await entry.socket.sendMessage(
        jid,
        buildBaileysMediaContent(media, mentions) as AnyMessageContent,
        { messageId, mediaUploadTimeoutMs: env.MEDIA_UPLOAD_IDLE_TIMEOUT_MS, ...(quoted ? { quoted } : {}) },
      );
      baileysLogger.info({ ...log, durationMs: Date.now() - startedAt }, 'Media sent');
      const sentId = result?.key?.id ?? messageId;
      // Guardado para o getMessage: aparelho do grupo que não decifrou a mídia pede reenvio.
      if (result?.message) sentMediaCache().set(sessionId, sentId, result.message);
      return { messageId: sentId, sentAt: new Date() };
    } catch (err) {
      if (!(err instanceof MediaTooLargeError)) {
        baileysLogger.warn({ ...log, err }, 'Failed to send media');
      }
      throw translateSendError(err, 'media not accepted by engine');
    }
  }

  async sendReaction(input: SendReactionInput): Promise<SendMessageResult> {
    const { sessionId, target, emoji, reactedAt } = input;
    const log = { sessionId, targetId: target.externalId, emoji };

    // Pré-condições antes do socket: falha rápida, sem envio parcial.
    const entry = this.registry.get(sessionId);
    if (!entry || !entry.socket.user || !entry.socket.ws.isOpen) {
      throw new SessionNotConnectedError(sessionId);
    }
    const remoteJid = this.normalizeJid(target.remoteJid);
    if (remoteJid.endsWith('@g.us') && !target.fromMe && !target.participant) {
      // Key de grupo sem participant é aceita pelo WhatsApp e não aplicada — falha silenciosa.
      baileysLogger.warn(log, 'Group reaction target without participant');
      throw new MessageSendFailedError('group reaction target without participant');
    }

    const key = {
      id: target.externalId,
      remoteJid,
      fromMe: target.fromMe,
      ...(target.participant ? { participant: this.normalizeJid(target.participant) } : {}),
    };

    // Id pré-gerado e registrado ANTES do envio: o eco é emitido de dentro do sendMessage.
    // Falha de envio não retira o id — o eco tardio de um timeout ainda precisa da marca.
    // Registro de módulo, não da instância: há dois adapters no processo e o eco chega no
    // handler de quem abriu o socket, que pode não ser quem enviou.
    const messageId = generateMessageIDV2(entry.socket.user.id);
    outboundEchoRegistries().reactions.register(sessionId, messageId);

    try {
      const result = await entry.socket.sendMessage(
        remoteJid,
        { react: { text: emoji ?? '', key, senderTimestampMs: reactedAt.getTime() } },
        { messageId },
      );
      baileysLogger.info({ ...log, reactionId: messageId }, 'Reaction sent');
      return { messageId: result?.key?.id ?? messageId, sentAt: new Date() };
    } catch (err) {
      baileysLogger.warn({ ...log, reactionId: messageId, err }, 'Failed to send reaction');
      throw translateSendError(err, 'reaction not accepted by engine');
    }
  }

  async markMessagesRead(input: MarkMessagesReadInput): Promise<void> {
    const entry = this.registry.get(input.sessionId);
    if (!entry || input.messageIds.length === 0) return;
    const jid = this.normalizeJid(input.remoteJid);
    const keys = input.messageIds.map((id) => ({
      remoteJid: jid,
      id,
      fromMe: false as const,
      participant: undefined,
    }));
    try {
      await entry.socket.readMessages(keys);
    } catch (err) {
      baileysLogger.warn({ err, sessionId: input.sessionId }, 'Failed to send read receipts');
    }
  }

  async presenceSubscribe(sessionId: string, phone: string): Promise<void> {
    const entry = this.registry.get(sessionId);
    if (!entry) return;
    const jid = this.normalizeJid(phone);
    try {
      await entry.socket.presenceSubscribe(jid);
    } catch (err) {
      baileysLogger.warn({ err, sessionId, phone }, 'Failed to subscribe to presence');
    }
  }

  async sendPresence(sessionId: string, to: string, presence: 'composing' | 'paused'): Promise<void> {
    const entry = this.requireConnectedEntry(sessionId);
    const jid = this.normalizeJid(to);
    try {
      if (presence === 'composing') {
        // A conta sobe "indisponível" (markOnlineOnConnect: false, para o celular seguir
        // notificando) e o WhatsApp não exibe o chatstate de quem está offline. Fica
        // "disponível" só enquanto digita; `paused` devolve ao estado anterior.
        if (!this.typingOnline.has(sessionId)) {
          await entry.socket.sendPresenceUpdate('available');
          this.typingOnline.add(sessionId);
        }
        await entry.socket.sendPresenceUpdate('composing', jid);
        await this.sendGroupChatStateAsLid(entry.socket, jid, 'composing');
        baileysLogger.info({ sessionId, jid, presence, name: !!entry.socket.user?.name }, 'Presence sent');
        return;
      }
      await entry.socket.sendPresenceUpdate('paused', jid);
      await this.sendGroupChatStateAsLid(entry.socket, jid, 'paused');
      if (this.typingOnline.delete(sessionId)) await entry.socket.sendPresenceUpdate('unavailable');
      baileysLogger.info({ sessionId, jid, presence }, 'Presence sent');
    } catch (err) { throw translateEngineError(err); }
  }

  /**
   * Grupo é endereçado por LID no Baileys 7 (`addressing_mode: 'lid'`), mas o
   * `sendPresenceUpdate` da lib manda o chatstate de grupo com `from` = JID de telefone
   * (só usa `me.lid` quando o destino é `@lid`). Reenvia o mesmo chatstate com a identidade
   * LID: é a que os outros participantes conhecem. Melhor esforço — falha não segura o envio.
   */
  private async sendGroupChatStateAsLid(
    socket: ReturnType<typeof makeWASocket>,
    jid: string,
    state: 'composing' | 'paused',
  ): Promise<void> {
    const lid = socket.user?.lid;
    if (!jid.endsWith('@g.us') || !lid) return;
    try {
      await socket.sendNode({ tag: 'chatstate', attrs: { from: lid, to: jid }, content: [{ tag: state, attrs: {} }] });
    } catch (err) {
      baileysLogger.debug({ jid, err: (err as Error)?.message }, 'LID chatstate failed');
    }
  }

  async listParticipatingGroups(sessionId: string): Promise<ParticipatingGroupInfo[]> {
    const entry = this.requireConnectedEntry(sessionId);
    const cached = this.participatingGroupsCache.get(sessionId);
    if (cached && Date.now() - cached.at < PARTICIPATING_GROUPS_TTL_MS) return cached.groups;
    try {
      const all = await entry.socket.groupFetchAllParticipating();
      const groups = Object.values(all).map((g) => ({
        groupJid: g.id.split('@')[0]!,
        name: g.subject?.trim() || null,
      }));
      this.participatingGroupsCache.set(sessionId, { groups, at: Date.now() });
      return groups;
    } catch (err) { throw translateEngineError(err); }
  }

  async getGroupParticipants(sessionId: string, groupJid: string): Promise<GroupParticipantInfo[]> {
    const entry = this.requireConnectedEntry(sessionId);
    const remoteJid = groupJid.endsWith('@g.us') ? groupJid : `${groupJid}@g.us`;

    try {
      const metadata = await (entry.socket as BaileysSocketWithGroupHelpers).groupMetadata?.(remoteJid);
      const participants = metadata?.participants ?? [];

      // Foto de perfil é uma consulta por participante ao WhatsApp; buscamos só até
      // GROUP_AVATAR_FETCH_LIMIT para não transformar a abertura de um grupo grande em
      // dezenas de idas à rede. Acima disso o painel cai nas iniciais.
      const avatarByJid = new Map<string, string | null>();
      const targets = participants
        .map((p) => p.id)
        .filter((jid): jid is string => !!jid)
        .slice(0, GROUP_AVATAR_FETCH_LIMIT);

      // Em lotes: 172 consultas simultâneas fazem o WhatsApp responder com timeout.
      for (let i = 0; i < targets.length; i += GROUP_AVATAR_CONCURRENCY) {
        const slice = targets.slice(i, i + GROUP_AVATAR_CONCURRENCY);
        await Promise.all(
          slice.map(async (jid) => {
            const cached = this.profilePictureCache.get(jid);
            if (cached && Date.now() - cached.at < PROFILE_PICTURE_TTL_MS) {
              avatarByJid.set(jid, cached.url);
              return;
            }
            try {
              const url = await entry.socket.profilePictureUrl(jid, 'preview');
              avatarByJid.set(jid, url ?? null);
              this.profilePictureCache.set(jid, { url: url ?? null, at: Date.now() });
            } catch {
              // Sem foto, restrita por privacidade ou timeout — cai nas iniciais.
              // O resultado negativo também é cacheado: repetir não muda a resposta.
              avatarByJid.set(jid, null);
              this.profilePictureCache.set(jid, { url: null, at: Date.now() });
            }
          }),
        );
      }

      return participants.filter((p) => !!(p.id ?? p.phoneNumber)).map((p) => {
        // Em grupos com privacidade de número o `id` vem como @lid e o telefone real,
        // quando disponível, chega em `phoneNumber` — mesmo par de campos das mensagens
        // (participant/participantAlt). Sem telefone devolvemos null em vez do LID, que
        // é identificador interno e não deve ser exibido como número.
        const rawId = p.phoneNumber ?? p.id ?? '';
        const digits = rawId.split('@')[0] ?? '';
        const phone = rawId.includes('@lid') || !/^\d{8,15}$/.test(digits) ? null : digits;

        return {
          jid: p.id ?? p.phoneNumber ?? '',
          phone,
          name: p.name ?? p.notify ?? p.verifiedName ?? null,
          avatarUrl: (p.id ? avatarByJid.get(p.id) : null) ?? null,
          isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
        };
      });
    } catch (err) {
      throw translateEngineError(err);
    }
  }

  async fetchProfilePicture(sessionId: string, jid: string, isGroup: boolean): Promise<string | null> {
    const entry = this.registry.get(sessionId);
    if (!entry) return null;

    const remoteJid = isGroup ? `${jid}@g.us` : `${jid}@s.whatsapp.net`;
    const filename = `avatar_${isGroup ? 'g' : 'c'}_${jid}.jpg`;
    const cacheKey = `stored:${remoteJid}`;

    // Sem cache, cada listagem rebaixaria a mesma imagem.
    const cached = this.profilePictureCache.get(cacheKey);
    if (cached && Date.now() - cached.at < PROFILE_PICTURE_TTL_MS) {
      return cached.url;
    }

    try {
      const url = await entry.socket.profilePictureUrl(remoteJid, 'image');
      if (!url) {
        this.profilePictureCache.set(cacheKey, { url: null, at: Date.now() });
        return null;
      }

      // A URL do WhatsApp expira em algumas horas: baixamos a imagem e servimos por
      // conta própria, para o avatar não quebrar depois de persistido.
      const response = await fetch(url);
      if (!response.ok) return null;

      const buffer = Buffer.from(await response.arrayBuffer());
      const store = mediaContainer.mediaFileStore;
      const publicUrl = await store.saveBuffer(buffer, filename);
      this.profilePictureCache.set(cacheKey, { url: publicUrl, at: Date.now() });
      return publicUrl;
    } catch (err) {
      baileysLogger.debug({ err, sessionId, jid, isGroup }, 'Failed to fetch profile picture');
      return null;
    }
  }

  async checkNumberExists(sessionId: string, phone: string): Promise<boolean | null> {
    const entry = this.registry.get(sessionId);
    if (!entry) return null;

    try {
      const results = await entry.socket.onWhatsApp(`${phone}@s.whatsapp.net`);
      const match = results?.[0];
      return match ? match.exists : false;
    } catch (err) {
      baileysLogger.debug({ err, sessionId, phone }, 'Failed to check number on WhatsApp');
      return null;
    }
  }

  async updateChatState(input: UpdateChatStateInput): Promise<void> {
    const entry = this.requireConnectedEntry(input.sessionId);
    const jid = input.isGroup ? `${input.chatId}@g.us` : `${input.chatId}@s.whatsapp.net`;

    // archive e markRead exigem a última mensagem para o WhatsApp localizar o ponto
    // da conversa; sem ela o protocolo rejeita a modificação.
    const lastMessages = input.lastMessage
      ? [{
          key: { remoteJid: jid, id: input.lastMessage.externalId, fromMe: input.lastMessage.fromMe },
          messageTimestamp: Math.floor(input.lastMessage.timestamp.getTime() / 1000),
        }]
      : [];

    try {
      if (input.archived !== undefined) {
        await entry.socket.chatModify({ archive: input.archived, lastMessages }, jid);
      }
      if (input.pinned !== undefined) {
        await entry.socket.chatModify({ pin: input.pinned }, jid);
      }
      if (input.muteMs !== undefined) {
        await entry.socket.chatModify({ mute: input.muteMs }, jid);
      }
      if (input.read !== undefined) {
        await entry.socket.chatModify({ markRead: input.read, lastMessages }, jid);
      }
    } catch (err) {
      throw translateEngineError(err);
    }
  }

  // -- Private ------------------------------------------------------------------

  private async openSocket(sessionId: string, tenantId: string, attempt: number): Promise<void> {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await buildBaileysAuthState(sessionId, tenantId, this.authStateRepo);

    const socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger as never),
      },
      browser: Browsers.ubuntu('Chrome'),
      logger: baileysLogger as never,
      // printQRInTerminal foi deprecado na 7.0.0-rc14 e só emite aviso: o QR já é lido
      // do evento connection.update e publicado via SESSION_QR_UPDATED.
      markOnlineOnConnect: false,
      // Cada QR vive 2 min (padrão da lib: 60 s no 1º e 20 s nos seguintes). O painel conta o
      // mesmo tempo (QR_TTL_MS em app/src/features/sessions/utils.ts): mudar aqui = mudar lá.
      qrTimeout: QR_TIMEOUT_MS,
      syncFullHistory: env.BAILEYS_SYNC_FULL_HISTORY,
      // Responde o pedido de reenvio de criptografia da nossa mídia (aparelho de grupo que não
      // decifrou). Texto, reação e o resto seguem undefined: não são reenviados.
      getMessage: async (key: proto.IMessageKey): Promise<proto.IMessage | undefined> =>
        key.id ? sentMediaCache().get(sessionId, key.id) : undefined,
    });

    const epoch = this.registry.nextEpoch();
    this.registry.set(sessionId, { socket, tenantId, epoch, reconnectAttempt: attempt });
    internalEventBus.emit('SESSION_CONNECTING', { type: 'SESSION_CONNECTING', sessionId, tenantId });

    /** True once this socket has been replaced by a newer one — its events must be ignored. */
    const isStale = (): boolean => !this.registry.isCurrentEpoch(sessionId, epoch);

    socket.ev.on('creds.update', async () => {
      if (isStale()) return;
      try { await saveCreds(); }
      catch (err) { baileysLogger.error({ err, sessionId }, 'Failed to persist credentials'); }
    });

    socket.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      try {
        const { connection, lastDisconnect, qr } = update;

        if (isStale()) {
          // A newer socket owns this session; only clean up after ourselves.
          if (connection === 'close') {
            this.detachSocket(socket);
            baileysLogger.debug({ sessionId, epoch }, 'Ignoring close from superseded socket');
          }
          return;
        }

        if (qr) {
          this.registry.setQr(sessionId, qr);
          const pairingPhone = this.pairingPhones.get(sessionId);
          const entry = this.registry.get(sessionId);
          if (pairingPhone && entry?.pairingCodePhone !== pairingPhone) {
            // Modo código: o WhatsApp só aceita o pedido depois do handshake, que é
            // quando a lib emite o primeiro QR.
            try {
              await this.issuePairingCode(sessionId, tenantId, pairingPhone);
            } catch (err) {
              // Sai do modo código: cada rotação do QR não repete o pedido; o operador pede de novo
              this.pairingPhones.delete(sessionId);
              baileysLogger.warn({ err, sessionId }, 'Pairing code request failed — QR still available');
              await this.updateSessionStatus(sessionId, tenantId, 'AWAITING_QR');
            }
          } else if (!pairingPhone) {
            await this.updateSessionStatus(sessionId, tenantId, 'AWAITING_QR');
          }
          // Em modo código o status fica AWAITING_PAIRING; o QR segue disponível em GET /qr.
          internalEventBus.emit('SESSION_QR_UPDATED', { type: 'SESSION_QR_UPDATED', sessionId, tenantId, qrCode: qr });
          baileysLogger.info({ sessionId }, 'QR code updated');
        }

        if (connection === 'open') {
          this.registry.clearQr(sessionId);
          this.registry.clearPairingCode(sessionId);
          this.pairingPhones.delete(sessionId);
          // Connection is healthy again — the backoff budget and the pairing guard reset.
          this.registry.setReconnectAttempt(sessionId, 0);
          this.pairingRestarts.delete(sessionId);
          const phone = state.creds.me?.id?.split(':')[0] ?? null;
          await this.updateConnectedSessionStatus(sessionId, tenantId);
          if (phone) {
            try { await this.sessionRepo.updatePhone(sessionId, tenantId, phone); } catch { /* best-effort */ }
          }
          internalEventBus.emit('SESSION_CONNECTED', { type: 'SESSION_CONNECTED', sessionId, tenantId });
          baileysLogger.info({ sessionId, phone }, 'Session connected');
        }

        if (connection === 'close') {
          const { shouldReconnect, shouldClearCredentials, takenOverByAnotherInstance, error } =
            translateDisconnect(sessionId, lastDisconnect?.error);
          baileysLogger.warn(
            { sessionId, shouldReconnect, shouldClearCredentials, takenOverByAnotherInstance, errorCode: error.code },
            'Session disconnected',
          );

          // Current attempt count lives in the registry so a successful 'open' resets it.
          const currentAttempt = this.registry.getReconnectAttempt(sessionId);
          this.detachSocket(socket);
          this.registry.deleteIfCurrentEpoch(sessionId, epoch);
          this.clearSessionGroupMetadata(sessionId);

          if (takenOverByAnotherInstance) {
            // The instance that took the session over already wrote CONNECTED. Writing
            // FAILED here (as this path used to) overwrote it a few hundred ms later, and
            // the next deploy's bootstrap — which only picks CONNECTED sessions — skipped
            // the session for good. Two back-to-back deploys were enough to kill it.
            baileysLogger.info({ sessionId, epoch }, 'Session taken over by another instance — leaving status to it');
            this.pairingPhones.delete(sessionId);
            return;
          }

          internalEventBus.emit('SESSION_DISCONNECTED', {
            type: 'SESSION_DISCONNECTED', sessionId, tenantId, reason: error.code,
          });

          if (shouldClearCredentials) {
            // WhatsApp revoked this device: the stored credentials can never connect
            // again.  Wipe them so the very same session (and therefore its whole chat
            // history) can be paired again with a fresh QR code.
            await this.discardCredentials(sessionId, tenantId, error.code);
            return;
          }

          if (!shouldReconnect) {
            this.pairingPhones.delete(sessionId);
            await this.updateSessionStatus(sessionId, tenantId, 'FAILED');
            return;
          }

          await this.updateSessionStatus(sessionId, tenantId, 'DISCONNECTED');

          const nextAttempt = currentAttempt + 1;
          if (nextAttempt <= RECONNECT_MAX_ATTEMPTS) {
            const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, currentAttempt);
            baileysLogger.info({ sessionId, nextAttempt, delayMs: delay }, 'Scheduling auto-reconnect');
            setTimeout(() => {
              // A manual connect/reconnect may have already opened a new socket meanwhile.
              if (this.registry.has(sessionId)) {
                baileysLogger.debug({ sessionId }, 'Auto-reconnect skipped — session already active');
                return;
              }
              this.openSocket(sessionId, tenantId, nextAttempt).catch((err) => {
                baileysLogger.error({ err, sessionId }, 'Auto-reconnect failed');
              });
            }, delay);
          } else {
            baileysLogger.error({ sessionId }, 'Max reconnect attempts - marking FAILED');
            this.pairingPhones.delete(sessionId);
            await this.updateSessionStatus(sessionId, tenantId, 'FAILED');
          }
        }
      } catch (err) {
        baileysLogger.error({ err, sessionId }, 'Unhandled connection.update error');
      }
    });
    // ── Incoming messages ──────────────────────────────────────────────────
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (isStale()) return;
      try {
        // 'notify' = mensagem em tempo real.
        // 'append' = entrega offline: mensagens que chegaram enquanto a sessão estava
        // fora do ar e o WhatsApp acumulou (o Baileys marca `offline` como 'append').
        // São mensagens reais endereçadas ao tenant, não histórico antigo, então são
        // sempre ingeridas — do contrário todo restart da API perderia silenciosamente
        // tudo que chegou durante o deploy. O dedupe por externalMessageId no
        // IngestHistorySyncUseCase evita gravar duas vezes.
        if (type !== 'notify') {
          if (type === 'append') {
            setImmediate(async () => {
              try {
                const items = await this.mapMessagesToHistoryItems(messages, socket, sessionId, tenantId);
                if (items.length > 0) {
                  this.historySyncUseCase.execute({ tenantId, sessionId, messages: items });
                }
              } catch (err) {
                baileysLogger.warn({ err, sessionId }, 'Failed to process append history messages');
              }
            });
          }
          return;
        }

        for (const msg of messages) {
        const jidRaw = msg.key?.remoteJid;
        if (!jidRaw) continue;
        if (jidRaw.endsWith('@broadcast') || jidRaw === 'status@broadcast') continue;

        // Resolve LID (Linked Identity) → JID real usando remoteJidAlt fornecido pelo Baileys.
        // Quando o contato usa privacidade de número, o remoteJid vem como @lid;
        // o Baileys preenche key.remoteJidAlt com o JID @s.whatsapp.net real.
        let jid = jidRaw;
        if (jidRaw.endsWith('@lid')) {
          const alt = (msg.key as { remoteJidAlt?: string }).remoteJidAlt;
          if (!alt || !alt.includes('@s.whatsapp.net')) {
            baileysLogger.debug({ sessionId, jidRaw }, 'LID sem remoteJidAlt — mensagem ignorada');
            continue;
          }
          jid = alt;
        }

        const routing = await this.buildIncomingMessageRoutingInfo(msg, socket, sessionId, jid);
        if (!routing) continue;
        const fromMe = msg.key.fromMe ?? false;

        // Extrai tipo, corpo e metadados da mensagem
        const extracted = extractBaileysMessage(msg.message ?? {});

        // Ignora mensagens sem tipo reconhecido (ex: protocolMessages, reactionMessages)
        if (!extracted) continue;

        extracted.body = await this.resolveMentionsInBody(
          socket, sessionId, routing.groupJid, extracted.body, extracted.mentionedJids,
        );

        let mediaUrl: string | null = null;
        if (
          MEDIA_TYPES_WITH_BINARY.has(extracted.msgType)
          && await this.shouldAutoDownloadGroupMedia(routing, sessionId, tenantId)
        ) {
          mediaUrl = await downloadBaileysMedia(msg, socket, sessionId, extracted.mimeType);
        }

        internalEventBus.emit('MESSAGE_RECEIVED', {
          type: 'MESSAGE_RECEIVED',
          sessionId,
          tenantId,
          from: routing.from,
          fromName: routing.fromName,
          body: extracted.body,
          msgType: extracted.msgType,
          mediaUrl,
          mimeType: extracted.mimeType,
          fileName: extracted.fileName,
          durationSeconds: extracted.durationSeconds,
          isDeleted: extracted.isDeleted,
          quotedMessageId: extracted.quotedMessageId,
          fromMe,
          isGroup: routing.isGroup,
          groupJid: routing.groupJid,
          groupName: routing.groupName,
          participant: routing.participant,
          participantName: routing.participantName,
          externalMessageId: msg.key.id ?? undefined,
          raw: msg,
        });

        baileysLogger.info(
          {
            sessionId,
            from: routing.from,
            groupJid: routing.groupJid,
            participant: routing.participant,
            msgId: msg.key.id,
            msgType: extracted.msgType,
          },
          'Incoming message received',
        );
        }
      } catch (err) {
        baileysLogger.error({ err, sessionId }, 'Unhandled messages.upsert error');
      }
    });

    // ── Delivery / read receipts for sent messages ─────────────────────────
    // Fires when WA reports a new status for messages we sent:
    //   status 3 (DELIVERY_ACK) → recipient device received it → DELIVERED
    //   status 4 (READ)         → recipient read it            → READ
    //   status 5 (PLAYED)       → recipient played audio/video → READ
    socket.ev.on('messages.update', (updates) => {
      if (isStale()) return;
      for (const { key, update } of updates) {
        if (!key.fromMe || !key.id || !update.status) continue;

        const status = update.status as number;
        if (status === 3) {
          internalEventBus.emit('MESSAGE_DELIVERED', {
            type: 'MESSAGE_DELIVERED',
            sessionId,
            tenantId,
            messageId: key.id,
          });
        } else if (status === 4 || status === 5) {
          internalEventBus.emit('MESSAGE_READ', {
            type: 'MESSAGE_READ',
            sessionId,
            tenantId,
            messageId: key.id,
          });
        }
      }
    });

    // ── Reações ─────────────────────────────────────────────────────────────
    // Único caminho de ingestão de reação: extractBaileysMessage devolve null para
    // reactionMessage no messages.upsert. Chega também o eco das nossas (emitOwnEvents).
    socket.ev.on('messages.reaction', async (items) => {
      if (isStale()) return;
      for (const item of items) {
        try {
          const normalized = normalizeReactionEvent(item, {
            consumeEcho: (reactionId) => outboundEchoRegistries().reactions.consume(sessionId, reactionId),
          });
          if (!normalized) continue;

          const { unresolvedLid, ...reaction } = normalized;
          // LID sem alternativa no evento: tenta o mapeamento da sessão. Sem resolução a
          // reação segue com telefone nulo — não é descartada como no messages.upsert.
          const reactorPhone = reaction.reactorPhone
            ?? (unresolvedLid ? (await this.resolveParticipantPhone(socket, unresolvedLid)) ?? null : null);

          internalEventBus.emit('MESSAGE_REACTION_UPDATED', {
            type: 'MESSAGE_REACTION_UPDATED',
            sessionId,
            tenantId,
            ...reaction,
            reactorPhone,
            // O evento de reação não traz pushName.
            reactorName: null,
          });
          baileysLogger.debug(
            {
              sessionId,
              targetId: reaction.targetExternalMessageId,
              emoji: reaction.emoji,
              fromMe: reaction.fromMe,
              isEcho: reaction.isEcho,
            },
            'Reaction received',
          );
        } catch (err) {
          baileysLogger.warn({ err, sessionId }, 'Failed to process reaction');
        }
      }
    });

    // ── History sync ────────────────────────────────────────────────────────
    // ── Estado de conversa alterado em outro aparelho ────────────────────────
    // Arquivamento, leitura, fixação e silenciamento chegam por chats.update (mudança
    // feita em qualquer aparelho) e por messaging-history.set (retrato em massa, com o
    // total de não lidas).
    //
    // Nada aqui origina chamada ao WhatsApp: só consome o que o socket já entrega.
    const emitChatState = (
      chat: { id?: string | null } & RawChatState,
      source: ChatStateSource = 'update',
    ): void => {
      const chatId = chat.id;
      if (!chatId) return;
      if (chatId.endsWith('@broadcast') || chatId.endsWith('@lid')) return;

      const state = normalizeChatState(chat, { source });
      // Evento sem nada aproveitável não entra no barramento: a sincronização inicial
      // traz centenas de chats e a maioria não tem estado a espelhar.
      if (isEmptyChatState(state)) return;

      const isGroup = chatId.endsWith('@g.us');
      baileysLogger.debug({ sessionId, chatId, source, state }, 'Remote chat state received');
      internalEventBus.emit('CHAT_STATE_UPDATED', {
        type: 'CHAT_STATE_UPDATED',
        sessionId,
        tenantId,
        chatId: chatId.split('@')[0],
        isGroup,
        state,
      });
    };

    socket.ev.on('messaging-history.set', ({ messages: histMsgs, chats: histChats }) => {
      if (isStale()) return;

      // History sync é a única entrega em massa de estado de conversa: na lib instalada
      // o chats.upsert só é emitido quando um grupo é criado (Socket/messages-recv.js),
      // e não traz arquivamento nem contador. Por ser estado de conversa, e não
      // histórico de mensagens, roda independentemente de BAILEYS_SYNC_FULL_HISTORY.
      // O retrato de cada chat serve a dois caminhos: espelhar em conversa que já existe
      // (evento abaixo) e semear a que ainda vai ser criada pela ingestão deste mesmo
      // lote. Sem o segundo, a conversa importada nasceria lida, desarquivada e sem
      // fixação — o espelhamento roda antes da ingestão e não acha o que atualizar.
      const chatStates: Record<string, RemoteChatState> = {};
      let chatsSemChave = 0;
      for (const chat of histChats ?? []) {
        emitChatState(chat, 'history');

        const chatId = chat.id;
        if (!chatId || chatId.endsWith('@broadcast')) continue;

        // Chat entregue por LID: o telefone real vem em pnJid, o mesmo caminho que o
        // mapeamento de mensagens usa. Sem ele não há chave em comum com a ingestão.
        let chaveJid = chatId;
        if (chatId.endsWith('@lid')) {
          const pnJid = (chat as { pnJid?: string | null }).pnJid;
          if (!pnJid) { chatsSemChave++; continue; }
          chaveJid = pnJid;
        }

        const state = normalizeChatState(chat, { source: 'history' });
        if (!isEmptyChatState(state)) chatStates[chaveJid.split('@')[0]] = state;
      }
      if (chatsSemChave > 0) {
        baileysLogger.debug(
          { sessionId, count: chatsSemChave },
          'History chats skipped: LID without pnJid, initial state will not be seeded',
        );
      }
      if (!env.BAILEYS_SYNC_FULL_HISTORY) {
        baileysLogger.debug(
          { sessionId, count: histMsgs.length },
          'Skipping messaging-history.set because BAILEYS_SYNC_FULL_HISTORY is disabled',
        );
        return;
      }

      setImmediate(async () => {
        try {
          // histMsgs é WAMessage[] (proto.IWebMessageInfo[]) — passar direto
          const items = await this.mapMessagesToHistoryItems(histMsgs, socket, sessionId, tenantId);
          if (items.length > 0) {
            baileysLogger.info(
              { sessionId, count: items.length },
              'History sync batch received',
            );
            this.historySyncUseCase.execute({ tenantId, sessionId, messages: items, chatStates });
          }
        } catch (err) {
          baileysLogger.warn({ err, sessionId }, 'Failed to process messaging-history.set');
        }
      });
    });

    socket.ev.on('chats.upsert', (chats) => {
      if (isStale()) return;
      for (const chat of chats) emitChatState(chat);
    });

    socket.ev.on('chats.update', (update) => {
      if (isStale()) return;
      for (const chat of update) emitChatState(chat);
    });

    // ── Contacts upsert ──────────────────────────────────────────────────────
    socket.ev.on('contacts.upsert', (contacts) => {
      if (isStale()) return;
      setImmediate(async () => {
        const pending: Array<{ phone: string; name: string }> = [];
        for (const c of contacts) {
          const rawJid = c.id;
          if (!rawJid || rawJid.endsWith('@g.us') || rawJid.endsWith('@broadcast')) continue;

          let phone: string;
          if (rawJid.endsWith('@lid')) {
            const phoneNumber = (c as { phoneNumber?: string }).phoneNumber;
            if (!phoneNumber) continue;
            phone = phoneNumber.replace(/\D/g, '');
            if (!phone) continue;
          } else {
            phone = rawJid.split('@')[0];
            if (!phone) continue;
          }

          const name = (c as { name?: string; notify?: string }).name
            ?? (c as { name?: string; notify?: string }).notify;
          if (!name || /^\d+$/.test(name)) continue;
          pending.push({ phone, name });
        }

        const BATCH = 8;
        for (let i = 0; i < pending.length; i += BATCH) {
          const slice = pending.slice(i, i + BATCH);
          await Promise.allSettled(
            slice.map(({ phone, name }) =>
              this.chatContactRepo
                .upsert({ tenantId, phone, name })
                .catch((err: unknown) =>
                  baileysLogger.warn({ err, phone }, 'Failed to upsert contact from contacts.upsert'),
                ),
            ),
          );
        }
      });
    });

    // ── Presence / typing ────────────────────────────────────────────────────
    socket.ev.on('presence.update', ({ id: jid, presences }) => {
      if (isStale()) return;
      if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@lid')) return;
      const phone = jid.split('@')[0];
      if (!phone) return;
      // Pick the first (and usually only) participant presence
      const entry = Object.values(presences)[0];
      if (!entry) return;
      internalEventBus.emit('PRESENCE_UPDATED', {
        type: 'PRESENCE_UPDATED',
        sessionId,
        tenantId,
        phone,
        presence: entry.lastKnownPresence,
      });
    });
  }

  // -- Private ------------------------------------------------------------------

  /**
   * Extrai HistoryMessageItem de mensagens brutas do Baileys.
   * Filtra broadcasts, mensagens sem conteúdo e sem ID.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async mapMessagesToHistoryItems(
    msgs: any[],
    socket: ReturnType<typeof makeWASocket>,
    sessionId: string,
    tenantId: string,
  ): Promise<HistoryMessageItem[]> {
    const items: HistoryMessageItem[] = [];
    const now = Date.now();
    for (const msg of msgs) {
      if (!msg) continue;
      const key = msg.key ?? msg?.message?.key;
      // Eco da mídia enviada pelo painel: já está gravada (PENDING) e baixá-la traria o
      // arquivo inteiro de volta em Buffer. Mídia enviada pelo celular não está no registro.
      if (isOwnOutboundEcho(key, (id) => outboundEchoRegistries().media.consume(sessionId, id))) {
        baileysLogger.debug({ sessionId, id: key.id }, 'Skipping own media echo');
        continue;
      }
      const jidRaw: string | undefined = key?.remoteJid;
      if (!jidRaw) continue;
      if (jidRaw.endsWith('@broadcast') || jidRaw === 'status@broadcast') continue;

      // Resolve LID → JID real via remoteJidAlt (fornecido pelo Baileys)
      let jid = jidRaw;
      if (jidRaw.endsWith('@lid')) {
        const alt: string | undefined = key?.remoteJidAlt;
        if (!alt || !alt.includes('@s.whatsapp.net')) continue;
        jid = alt;
      }

      const id: string | undefined = key?.id;
      if (!id) continue;

      const msgContent = msg.message ?? msg;
      const extracted = extractBaileysMessage(msgContent);
      if (!extracted) continue;

      const routing = await this.buildIncomingMessageRoutingInfo(msg, socket, sessionId, jid, tenantId);
      if (!routing) continue;

      extracted.body = await this.resolveMentionsInBody(
        socket, sessionId, routing.groupJid, extracted.body, extracted.mentionedJids,
      );

      const fromMe: boolean = key?.fromMe ?? false;
      const messageTimestamp = msg.messageTimestamp ?? msgContent?.messageTimestamp;
      const timestamp: Date = messageTimestamp
        ? new Date(Number(messageTimestamp) * 1000)
        : new Date();

      let mediaUrl: string | null = null;
      if (
        MEDIA_TYPES_WITH_BINARY.has(extracted.msgType)
        && (now - timestamp.getTime()) < THIRTY_MIN_MS
        && await this.shouldAutoDownloadGroupMedia(routing, sessionId, tenantId)
      ) {
        mediaUrl = await downloadBaileysMedia(msg, socket, sessionId, extracted.mimeType);
      }

      items.push({
        externalMessageId: id,
        from: routing.from,
        fromName: routing.fromName,
        body: extracted.body,
        msgType: extracted.msgType,
        mediaUrl,
        mimeType: extracted.mimeType,
        fileName: extracted.fileName,
        durationSeconds: extracted.durationSeconds,
        isDeleted: extracted.isDeleted,
        quotedMessageId: extracted.quotedMessageId,
        fromMe,
        timestamp,
        isGroup: routing.isGroup,
        groupJid: routing.groupJid,
        groupName: routing.groupName,
        participant: routing.participant,
        participantName: routing.participantName,
      });
    }
    return items;
  }

  private async buildIncomingMessageRoutingInfo(
    msg: proto.IWebMessageInfo,
    socket: ReturnType<typeof makeWASocket>,
    sessionId: string,
    resolvedRemoteJid: string,
    tenantId?: string,
  ): Promise<IncomingMessageRoutingInfo | null> {
    const rawRemoteJid = msg.key?.remoteJid;
    if (!rawRemoteJid) return null;

    const isGroup = rawRemoteJid.endsWith('@g.us');
    if (!isGroup) {
      return {
        from: resolvedRemoteJid.split('@')[0],
        fromName: msg.pushName ?? undefined,
        isGroup: false,
      };
    }

    const groupJid = rawRemoteJid.split('@')[0];
    const groupMetadata = await this.getGroupMetadataSnapshot(
      socket,
      sessionId,
      tenantId,
      rawRemoteJid,
      groupJid,
    );

    const participantJid = this.extractParticipantJid(msg);
    const participant = participantJid
      ? await this.resolveParticipantPhone(socket, participantJid)
      : undefined;

    return {
      from: groupJid,
      isGroup: true,
      groupJid,
      groupName: groupMetadata?.groupName ?? undefined,
      participant,
      participantName: participant ? (msg.pushName ?? undefined) : undefined,
    };
  }

  /**
   * Devolve o telefone real do participante, ou `undefined` quando ele não pode ser
   * resolvido.
   *
   * Nunca devolve o LID como fallback: o LID é identificador interno do WhatsApp e,
   * gravado em `fromParticipant`, era exibido no painel como se fosse um telefone.
   * Sem número, o painel mostra apenas o nome do participante — como o WhatsApp Web.
   */
  private async resolveParticipantPhone(
    socket: ReturnType<typeof makeWASocket>,
    participantJid: string,
  ): Promise<string | undefined> {
    if (!participantJid.endsWith('@lid')) {
      return participantJid.split('@')[0];
    }

    const lid = participantJid.split('@')[0];
    try {
      const mappedJid = await (socket as BaileysSocketWithGroupHelpers).signalRepository?.lidMapping?.getPNForLID?.(lid);
      if (mappedJid) {
        return mappedJid.split('@')[0];
      }
    } catch (err) {
      baileysLogger.debug({ err, participantJid }, 'Failed to resolve group participant LID');
    }

    baileysLogger.debug({ participantJid }, 'Group participant LID not resolvable to a phone');
    return undefined;
  }

  /**
   * Substitui, no corpo da mensagem, cada `@<lid>` (menção a participante com
   * privacidade de número ativa) pelo telefone real resolvido via `resolveParticipantPhone`.
   * Menções que já vêm como `@s.whatsapp.net` ou que não resolvem permanecem como
   * estavam — nunca lança, só retorna o corpo original nesses casos.
   */
  private async resolveMentionsInBody(
    socket: ReturnType<typeof makeWASocket>,
    sessionId: string,
    groupJid: string | null | undefined,
    body: string | null,
    mentionedJids: string[] | null | undefined,
  ): Promise<string | null> {
    if (!body || !mentionedJids || mentionedJids.length === 0) return body;

    // Metadata do grupo já buscado pelo roteamento desta mensagem; o store só conhece
    // o LID de quem já trocou chaves com a sessão, então uma menção a terceiro ficava sem resolver.
    const lidToPhone = groupJid ? this.groupMetadataCache.get(`${sessionId}:${groupJid}`)?.lidToPhone : undefined;

    let resolvedBody = body;
    for (const mentionedJid of mentionedJids) {
      if (!mentionedJid.endsWith('@lid')) continue;
      const lid = mentionedJid.split('@')[0];
      const phone = (await this.resolveParticipantPhone(socket, mentionedJid)) ?? lidToPhone?.[lid];
      if (phone && phone !== lid) {
        resolvedBody = resolvedBody.split(`@${lid}`).join(`@${phone}`);
      } else {
        baileysLogger.debug({ sessionId, groupJid, mentionedJid }, 'Mention LID not resolvable to a phone');
      }
    }
    return resolvedBody;
  }

  private extractParticipantJid(msg: proto.IWebMessageInfo): string | undefined {
    const participantFromKey = msg.key?.participant;
    if (participantFromKey) {
      // Quando o participante usa privacidade de número, `participant` vem como @lid
      // e o Baileys entrega o JID real em `participantAlt` — mesmo par de campos que
      // remoteJid/remoteJidAlt. Sem isso o LID acabava salvo como se fosse telefone.
      if (participantFromKey.endsWith('@lid')) {
        const alt = (msg.key as { participantAlt?: string }).participantAlt;
        if (alt?.includes('@s.whatsapp.net')) return alt;
      }
      return participantFromKey;
    }

    const content = unwrapBaileysMessageContent(msg.message ?? {});
    const contextInfo = content.extendedTextMessage?.contextInfo
      ?? content.imageMessage?.contextInfo
      ?? content.videoMessage?.contextInfo
      ?? content.audioMessage?.contextInfo
      ?? content.documentMessage?.contextInfo
      ?? content.stickerMessage?.contextInfo
      ?? undefined;

    return contextInfo?.participant ?? undefined;
  }

  private async getGroupMetadataSnapshot(
    socket: ReturnType<typeof makeWASocket>,
    sessionId: string,
    tenantId: string | undefined,
    groupRemoteJid: string,
    groupJid: string,
  ): Promise<GroupMetadataSnapshot | null> {
    const cacheKey = `${sessionId}:${groupJid}`;
    const cached = this.groupMetadataCache.get(cacheKey);
    if (cached) return cached;

    const pending = this.groupMetadataPending.get(cacheKey);
    if (pending) return pending;

    const request = (async () => {
      try {
        const metadata = await (socket as BaileysSocketWithGroupHelpers).groupMetadata?.(groupRemoteJid);
        const snapshot: GroupMetadataSnapshot = {
          groupName: metadata?.subject?.trim() || null,
          addressingMode: metadata?.addressingMode ?? null,
          lidToPhone: buildLidToPhoneMap(metadata?.participants as BaileysGroupParticipant[] | undefined),
        };
        this.groupMetadataCache.set(cacheKey, snapshot);
        if (!snapshot.groupName) {
          this.groupMetadataCache.delete(cacheKey);
          return null;
        }
        return snapshot;
      } catch (err) {
        baileysLogger.debug({ err, sessionId, tenantId, groupJid }, 'Failed to fetch group metadata');
        return null;
      } finally {
        this.groupMetadataPending.delete(cacheKey);
      }
    })();

    this.groupMetadataPending.set(cacheKey, request);
    return request;
  }

  private async shouldAutoDownloadGroupMedia(
    routing: IncomingMessageRoutingInfo,
    sessionId: string,
    tenantId: string,
  ): Promise<boolean> {
    if (!routing.isGroup || !routing.groupJid) {
      return true;
    }

    try {
      const conversation = await this.chatConversationRepo.findActiveByGroupAndSession(
        routing.groupJid,
        sessionId,
        tenantId,
      );

      return conversation?.autoDownloadMedia ?? false;
    } catch (err) {
      baileysLogger.warn({ err, sessionId, groupJid: routing.groupJid }, 'Failed to read autoDownloadMedia; skipping media download');
      return false;
    }
  }

  private clearSessionGroupMetadata(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of this.groupMetadataCache.keys()) {
      if (key.startsWith(prefix)) {
        this.groupMetadataCache.delete(key);
      }
    }
    for (const key of this.groupMetadataPending.keys()) {
      if (key.startsWith(prefix)) {
        this.groupMetadataPending.delete(key);
      }
    }
  }

  /**
   * Removes every listener this adapter registered on a socket.
   *
   * Baileys keeps emitting on a socket after `end()`, so a replaced socket would
   * otherwise keep ingesting messages and tearing down the session that succeeded it.
   */
  private detachSocket(socket: WASocket): void {
    for (const event of HANDLED_SOCKET_EVENTS) {
      try { socket.ev.removeAllListeners(event); } catch { /* best-effort */ }
    }
  }

  /**
   * Recovers a session whose credentials WhatsApp revoked.
   *
   * Wipes the dead credentials and immediately reopens the socket, so the pairing QR
   * is produced by the very same user action that hit the revoked credential — no
   * second click, no session parked in a dead state.
   *
   * The session row (and therefore every conversation and message bound to its id)
   * is left untouched — only `session_auth_states.statePayload` is cleared.
   */
  private async discardCredentials(sessionId: string, tenantId: string, reason: string): Promise<void> {
    // Credencial revogada: o número pedido antes não vale para o novo pareamento
    this.pairingPhones.delete(sessionId);
    try {
      await this.authStateRepo.clearCredentials(sessionId);
      baileysLogger.warn({ sessionId, reason }, 'Credentials revoked by WhatsApp — cleared');
    } catch (err) {
      // Could not clear: leave the session FAILED rather than claiming it is pairable.
      baileysLogger.error({ err, sessionId }, 'Failed to clear revoked credentials');
      await this.updateSessionStatus(sessionId, tenantId, 'FAILED');
      return;
    }

    // Loop guard: freshly generated credentials being revoked again means the problem
    // is not the stored state.  Park the session instead of reopening forever.
    if (this.pairingRestarts.has(sessionId)) {
      this.pairingRestarts.delete(sessionId);
      baileysLogger.error(
        { sessionId, reason },
        'Fresh credentials revoked again — session parked awaiting manual reconnect',
      );
      await this.parkAsLoggedOut(sessionId, tenantId);
      return;
    }

    this.pairingRestarts.add(sessionId);
    await this.updateSessionStatus(sessionId, tenantId, 'CONNECTING');

    try {
      await this.openSocket(sessionId, tenantId, 0);
      baileysLogger.info({ sessionId }, 'Socket reopened with clean credentials — awaiting QR');
    } catch (err) {
      this.pairingRestarts.delete(sessionId);
      baileysLogger.error({ err, sessionId }, 'Failed to reopen socket after clearing credentials');
      await this.parkAsLoggedOut(sessionId, tenantId);
    }
  }

  /**
   * Pede o código de pareamento ao socket atual, grava no registry e publica
   * AWAITING_PAIRING + SESSION_PAIRING_CODE_UPDATED. Erro sai traduzido. Pedido em andamento
   * para o mesmo número é reaproveitado (clique duplo, QR chegando durante o pedido).
   */
  private issuePairingCode(sessionId: string, tenantId: string, phone: string): Promise<string> {
    const current = this.pairingInFlight.get(sessionId);
    if (current?.phone === phone) return current.promise;
    const promise = this.requestPairingCodeOnSocket(sessionId, tenantId, phone).finally(() => {
      if (this.pairingInFlight.get(sessionId)?.promise === promise) this.pairingInFlight.delete(sessionId);
    });
    this.pairingInFlight.set(sessionId, { phone, promise });
    return promise;
  }

  private async requestPairingCodeOnSocket(sessionId: string, tenantId: string, phone: string): Promise<string> {
    const entry = this.registry.get(sessionId);
    if (!entry) throw new SessionNotConnectedError(sessionId);
    // Marca antes do await: QRs que chegarem durante o pedido não disparam outro.
    entry.pairingCodePhone = phone;
    let pairingCode: string;
    try {
      pairingCode = await entry.socket.requestPairingCode(phone);
    } catch (err) {
      if (this.registry.get(sessionId) === entry) entry.pairingCodePhone = undefined;
      throw translatePairingError(err);
    }
    // Socket trocado durante o pedido: o código não vale para o novo.
    if (this.registry.get(sessionId) !== entry) throw new SessionNotConnectedError(sessionId);

    this.registry.setPairingCode(sessionId, pairingCode);
    await this.updateSessionStatus(sessionId, tenantId, 'AWAITING_PAIRING');
    internalEventBus.emit('SESSION_PAIRING_CODE_UPDATED', {
      type: 'SESSION_PAIRING_CODE_UPDATED', sessionId, tenantId, pairingCode,
    });
    baileysLogger.info({ sessionId }, 'Pairing code issued');
    return pairingCode;
  }

  /** Marks the session as needing a manual, user-initiated pairing. */
  private async parkAsLoggedOut(sessionId: string, tenantId: string): Promise<void> {
    this.pairingPhones.delete(sessionId);
    await this.updateSessionStatus(sessionId, tenantId, 'LOGGED_OUT');
    internalEventBus.emit('SESSION_LOGGED_OUT', { type: 'SESSION_LOGGED_OUT', sessionId, tenantId });
  }

  private async updateSessionStatus(sessionId: string, tenantId: string, status: SessionStatus): Promise<void> {
    try {
      await this.sessionRepo.updateStatus(sessionId, tenantId, { status });
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        // Sessão apagada: nada de modo código pendente
        this.pairingPhones.delete(sessionId);
        return;
      }
      baileysLogger.warn({ err, sessionId, status }, 'Failed to update session status');
    }
  }

  private async updateConnectedSessionStatus(sessionId: string, tenantId: string): Promise<void> {
    try {
      await this.sessionRepo.updateStatus(sessionId, tenantId, {
        status: 'CONNECTED',
        lastConnectedAt: new Date(),
      });
    } catch (err) {
      if (err instanceof SessionNotFoundError) return;
      baileysLogger.warn({ err, sessionId }, 'Failed to mark session as connected');
    }
  }

  private requireConnectedEntry(sessionId: string) {
    const entry = this.registry.get(sessionId);
    if (!entry) throw new SessionNotConnectedError(sessionId);
    return entry;
  }

  /**
   * Citação para o `sendMessage`. Nunca derruba o envio: quando não dá para citar com
   * segurança (ver `buildBaileysQuotedMessage`), a mensagem sai sem citação e o motivo
   * vai para o log.
   */
  private async buildQuoted(
    socket: ReturnType<typeof makeWASocket>,
    tenantId: string,
    ref: QuotedMessageRef | null | undefined,
    jid: string,
    sessionId: string,
  ): Promise<WAMessage | undefined> {
    if (!ref) return undefined;
    const log = { sessionId, quotedId: ref.externalId };
    try {
      const authorJid = jid.endsWith('@g.us')
        ? await this.resolveQuoteAuthor(socket, tenantId, ref, jid, sessionId)
        : null;
      const result = buildBaileysQuotedMessage(ref, jid, (value) => this.normalizeJid(value), { authorJid });
      if (result.quoted) {
        // Diagnóstico da citação: só o tipo do autor e do conteúdo — nem id de pessoa, nem texto.
        const { participant, fromMe } = result.quoted.key;
        baileysLogger.info({
          ...log,
          author: participant ? (participant.endsWith('@lid') ? 'lid' : 'pn') : fromMe ? 'session' : 'chat',
          content: Object.keys(result.quoted.message)[0],
        }, 'Reply quote attached');
        return result.quoted as unknown as WAMessage;
      }
      baileysLogger.warn({ ...log, reason: result.skipped }, 'Reply sent without quote');
    } catch (err) {
      baileysLogger.warn({ ...log, err }, 'Failed to build quote — reply sent without it');
    }
    return undefined;
  }

  /**
   * Autor da citação em grupo, no endereçamento em que o grupo opera. Em grupo LID — o padrão
   * do Baileys quando o modo é desconhecido (`messages-send.js:544`) — a mensagem sai com o LID
   * como autor e os clientes oficiais citam pelo LID; citar pelo número diverge do que os
   * aparelhos têm. `null` = siga pelo número (comportamento padrão). Nunca lança.
   */
  private async resolveQuoteAuthor(
    socket: ReturnType<typeof makeWASocket>,
    tenantId: string,
    ref: QuotedMessageRef,
    groupRemoteJid: string,
    sessionId: string,
  ): Promise<string | null> {
    try {
      const groupJid = groupRemoteJid.split('@')[0];
      // Modo desconhecido (sem metadado ou consulta lenta) segue como LID, igual ao Baileys.
      const metadata = await withTimeout(
        this.getGroupMetadataSnapshot(socket, sessionId, tenantId, groupRemoteJid, groupJid),
        QUOTE_AUTHOR_LOOKUP_TIMEOUT_MS,
      );
      if (metadata?.addressingMode === 'pn') return null;

      if (ref.fromMe) {
        const meLid = socket.user?.lid;
        return meLid ? jidNormalizedUser(meLid) : null;
      }
      if (!ref.participant) return null;

      const participantJid = this.normalizeJid(ref.participant);
      if (participantJid.endsWith('@lid')) return jidNormalizedUser(participantJid);

      const lookup = (socket as BaileysSocketWithGroupHelpers).signalRepository?.lidMapping?.getLIDForPN?.(participantJid);
      const lid = lookup ? await withTimeout(lookup, QUOTE_AUTHOR_LOOKUP_TIMEOUT_MS) : null;
      return lid ? jidNormalizedUser(lid) : null;
    } catch (err) {
      baileysLogger.debug({ err, sessionId, quotedId: ref.externalId }, 'Quote author LID not resolved — using phone');
      return null;
    }
  }

  private normalizeJid(phone: string): string {
    if (phone.includes('@')) return phone;
    const clean = phone.replace(/[^0-9]/g, '');
    return `${clean}@s.whatsapp.net`;
  }
}

interface IncomingMessageRoutingInfo {
  from: string;
  fromName?: string;
  isGroup: boolean;
  groupJid?: string;
  groupName?: string;
  participant?: string;
  participantName?: string;
}

interface GroupMetadataSnapshot {
  groupName: string | null;
  /** 'lid' ou 'pn'; `null` quando a lib não informou (o Baileys trata como 'lid'). */
  addressingMode: 'lid' | 'pn' | null;
  /**
   * LID (dígitos) → telefone (dígitos) dos participantes, vindo do metadata do grupo
   * (`id`/`lid` + `phoneNumber`). O signal store só conhece o mapeamento de quem já trocou
   * chaves com a sessão; o metadata cobre o grupo inteiro.
   */
  lidToPhone: Readonly<Record<string, string>>;
}

function buildLidToPhoneMap(participants: readonly BaileysGroupParticipant[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of participants ?? []) {
    const lidJid = p.id?.endsWith('@lid') ? p.id : p.lid;
    const phoneJid = p.phoneNumber ?? (p.id?.endsWith('@s.whatsapp.net') ? p.id : undefined);
    const lid = lidJid?.split('@')[0];
    const phone = phoneJid?.split('@')[0];
    if (lid && phone && /^\d+$/.test(lid) && /^\d{8,15}$/.test(phone)) map[lid] = phone;
  }
  return map;
}

type BaileysGroupParticipant = {
  id?: string;
  lid?: string;
  phoneNumber?: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
  admin?: 'admin' | 'superadmin' | null;
};

type BaileysSocketWithGroupHelpers = ReturnType<typeof makeWASocket> & {
  groupMetadata?: (jid: string) => Promise<{
    subject?: string | null;
    participants?: BaileysGroupParticipant[];
    addressingMode?: 'lid' | 'pn';
  } | null | undefined>;
  signalRepository?: {
    lidMapping?: {
      getPNForLID?: (lid: string) => Promise<string | null | undefined>;
      getLIDForPN?: (pn: string) => Promise<string | null | undefined>;
    };
  };
};

const MEDIA_TYPES_WITH_BINARY = new Set<ChatMessageType>([
  ChatMessageType.IMAGE,
  ChatMessageType.VIDEO,
  ChatMessageType.AUDIO,
  ChatMessageType.DOCUMENT,
  ChatMessageType.STICKER,
]);

async function downloadBaileysMedia(
  msg: proto.IWebMessageInfo,
  socket: ReturnType<typeof makeWASocket>,
  sessionId: string,
  mimeType: string | null | undefined,
): Promise<string | null> {
  try {
    const ext = mimeTypeToExt(mimeType);
    const filename = `${sessionId}_${msg.key?.id ?? Date.now()}.${ext}`;
    const store = mediaContainer.mediaFileStore;

    if (await store.mediaExists(filename)) {
      return store.publicUrl(filename);
    }

    const buffer = (await downloadMediaMessage(
      msg as never,
      'buffer',
      {},
      { logger: baileysLogger as never, reuploadRequest: socket.updateMediaMessage },
    )) as Buffer;

    return await store.saveBuffer(buffer, filename);
  } catch (err) {
    baileysLogger.warn(
      { err, sessionId, msgId: msg.key?.id },
      'Failed to download WhatsApp media; message will be persisted without mediaUrl',
    );
    return null;
  }
}

// ── extractBaileysMessage ──────────────────────────────────────────────────────
/**
 * Extrai tipo, corpo e metadados de um objeto de mensagem Baileys (message.*).
 * Retorna null se o tipo não for suportado ou reconhecido.
 */
interface BaileysExtracted {
  msgType: ChatMessageType;
  body: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  durationSeconds?: number | null;
  isDeleted?: boolean;
  quotedMessageId?: string | null;
  mentionedJids?: string[] | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractBaileysMessage(m: Record<string, any>): BaileysExtracted | null {
  if (!m) return null;
  const content = unwrapBaileysMessageContent(m);

  // Detecta se é mensagem apagada (revoke)
  const isDeleted = !!(content.protocolMessage?.type === 0 || content.revokeMessage);

  // Extrai ID da mensagem citada (context info)
  const contextInfo = content.extendedTextMessage?.contextInfo
    ?? content.imageMessage?.contextInfo
    ?? content.videoMessage?.contextInfo
    ?? content.audioMessage?.contextInfo
    ?? content.documentMessage?.contextInfo
    ?? null;
  const quotedMessageId = contextInfo?.stanzaId ?? null;
  // Menções (@) no texto: o WhatsApp grava `@<id-sem-sufixo>` no corpo e devolve os
  // JIDs reais em contextInfo.mentionedJid. Quando o participante usa privacidade de
  // número, esse JID vem em formato @lid — precisa ser resolvido pelo chamador (que
  // tem acesso ao socket) antes de o texto ser persistido/exibido.
  const mentionedJids: string[] | null = Array.isArray(contextInfo?.mentionedJid) && contextInfo.mentionedJid.length > 0
    ? contextInfo.mentionedJid
    : null;

  // Texto simples
  if (content.conversation) {
    return { msgType: ChatMessageType.TEXT, body: content.conversation, quotedMessageId, isDeleted, mentionedJids };
  }
  if (content.extendedTextMessage?.text) {
    return {
      msgType: ChatMessageType.TEXT,
      body: content.extendedTextMessage.text,
      quotedMessageId,
      isDeleted,
      mentionedJids,
    };
  }

  // Imagem
  if (content.imageMessage) {
    return {
      msgType: ChatMessageType.IMAGE,
      body: content.imageMessage.caption ?? null,
      mimeType: content.imageMessage.mimetype ?? null,
      quotedMessageId,
      isDeleted,
      mentionedJids,
    };
  }

  // Vídeo
  if (content.videoMessage) {
    return {
      msgType: ChatMessageType.VIDEO,
      body: content.videoMessage.caption ?? null,
      mimeType: content.videoMessage.mimetype ?? null,
      durationSeconds: content.videoMessage.seconds ?? null,
      quotedMessageId,
      isDeleted,
      mentionedJids,
    };
  }

  // Áudio / PTT
  if (content.audioMessage) {
    return {
      msgType: ChatMessageType.AUDIO,
      body: null,
      mimeType: content.audioMessage.mimetype ?? null,
      durationSeconds: content.audioMessage.seconds ?? null,
      quotedMessageId,
      isDeleted,
    };
  }

  // Documento
  if (content.documentMessage) {
    return {
      msgType: ChatMessageType.DOCUMENT,
      body: content.documentMessage.caption ?? null,
      mimeType: content.documentMessage.mimetype ?? null,
      fileName: content.documentMessage.fileName ?? content.documentMessage.title ?? null,
      quotedMessageId,
      isDeleted,
      mentionedJids,
    };
  }

  // Sticker
  if (content.stickerMessage) {
    return {
      msgType: ChatMessageType.STICKER,
      body: null,
      mimeType: content.stickerMessage.mimetype ?? null,
      quotedMessageId,
      isDeleted,
    };
  }

  // Localização
  if (content.locationMessage) {
    const lat = content.locationMessage.degreesLatitude;
    const lng = content.locationMessage.degreesLongitude;
    const name = content.locationMessage.name ?? null;
    const body = name ? `${name} (${lat},${lng})` : `${lat},${lng}`;
    return { msgType: ChatMessageType.LOCATION, body, quotedMessageId, isDeleted };
  }

  // vCard (contato único ou múltiplos)
  if (content.contactMessage) {
    const body = content.contactMessage.vcard ?? content.contactMessage.displayName ?? null;
    return { msgType: ChatMessageType.VCARD, body, quotedMessageId, isDeleted };
  }
  if (content.contactsArrayMessage) {
    const first = content.contactsArrayMessage.contacts?.[0];
    const body = first?.vcard ?? first?.displayName ?? null;
    return { msgType: ChatMessageType.VCARD, body, quotedMessageId, isDeleted };
  }

  // Chamada
  if (content.call) {
    return { msgType: ChatMessageType.CALL_LOG, body: 'Chamada', quotedMessageId, isDeleted };
  }

  // protocolMessage (delete, ephemeral, etc.) — não ingere
  if (content.protocolMessage || content.reactionMessage || content.pollCreationMessage || content.keepInChatMessage) {
    return null;
  }

  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrapBaileysMessageContent(message: Record<string, any>): Record<string, any> {
  let current = message;

  while (current && typeof current === 'object') {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
      continue;
    }
    if (current.viewOnceMessage?.message) {
      current = current.viewOnceMessage.message;
      continue;
    }
    if (current.viewOnceMessageV2?.message) {
      current = current.viewOnceMessageV2.message;
      continue;
    }
    if (current.viewOnceMessageV2Extension?.message) {
      current = current.viewOnceMessageV2Extension.message;
      continue;
    }
    if (current.documentWithCaptionMessage?.message) {
      current = current.documentWithCaptionMessage.message;
      continue;
    }
    if (current.editedMessage?.message) {
      current = current.editedMessage.message;
      continue;
    }

    return current;
  }

  return message;
}
