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
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import type { ConnectionState, AnyMessageContent, WASocket, proto } from '@whiskeysockets/baileys';
import { saveMediaBuffer, mediaPublicUrl, mediaFileExists } from '../../../../../shared/storage/MediaStorage';
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
  SendTextMessageInput,
  SendMediaMessageInput,
  SendMessageResult,
  MarkMessagesReadInput,
  GroupParticipantInfo,
} from '../../../domain/contracts/IMessagingEngine';
import type { SessionStatus } from '../../../../sessions/domain/enums/SessionStatus';
import type { ISessionRepository } from '../../../../sessions/domain/contracts/ISessionRepository';
import type { ISessionAuthStateRepository } from '../../../../sessions/domain/contracts/ISessionAuthStateRepository';
import { buildBaileysAuthState } from './BaileysAuthStatePersistence';
import { BaileysSessionRegistry } from './BaileysSessionRegistry';
import { translateDisconnect, translateEngineError } from './BaileysErrorTranslator';
import {
  SessionNotFoundError,
  SessionNotConnectedError,
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
  /** Cache de fotos por JID: evita repetir a consulta a cada abertura do painel. */
  private readonly profilePictureCache = new Map<string, { url: string | null; at: number }>();

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
    // A user-initiated connect starts a fresh recovery cycle.
    this.pairingRestarts.delete(sessionId);
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

  async sendTextMessage(input: SendTextMessageInput): Promise<SendMessageResult> {
    const entry = this.requireConnectedEntry(input.sessionId);
    try {
      const jid = this.normalizeJid(input.to);
      const result = await entry.socket.sendMessage(jid, { text: input.body });
      return { messageId: result?.key?.id ?? crypto.randomUUID(), sentAt: new Date() };
    } catch (err) { throw translateEngineError(err); }
  }

  async sendMediaMessage(input: SendMediaMessageInput): Promise<SendMessageResult> {
    const entry = this.requireConnectedEntry(input.sessionId);
    try {
      const jid = this.normalizeJid(input.to);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content: Record<string, any> = { caption: input.caption };
      const url = input.mediaUrl;
      switch (input.mediaType) {
        case 'image':    content.image    = { url }; break;
        case 'video':    content.video    = { url }; break;
        case 'audio':    content.audio    = { url, ptt: false }; break;
        case 'document': content.document = { url }; break;
        case 'sticker':  content.sticker  = { url }; break;
      }
      const result = await entry.socket.sendMessage(jid, content as AnyMessageContent);
      return { messageId: result?.key?.id ?? crypto.randomUUID(), sentAt: new Date() };
    } catch (err) { throw translateEngineError(err); }
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

      return participants.map((p) => {
        // Em grupos com privacidade de número o `id` vem como @lid e o telefone real,
        // quando disponível, chega em `phoneNumber` — mesmo par de campos das mensagens
        // (participant/participantAlt). Sem telefone devolvemos null em vez do LID, que
        // é identificador interno e não deve ser exibido como número.
        const rawId = p.phoneNumber ?? p.id ?? '';
        const digits = rawId.split('@')[0] ?? '';
        const phone = rawId.includes('@lid') || !/^\d{8,15}$/.test(digits) ? null : digits;

        return {
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
      await saveMediaBuffer(buffer, filename);
      const publicUrl = mediaPublicUrl(filename);
      this.profilePictureCache.set(cacheKey, { url: publicUrl, at: Date.now() });
      return publicUrl;
    } catch (err) {
      baileysLogger.debug({ err, sessionId, jid, isGroup }, 'Failed to fetch profile picture');
      return null;
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
      syncFullHistory: env.BAILEYS_SYNC_FULL_HISTORY,
      // Baileys usa getMessage para re-envio e read receipts.
      // Retornar undefined é seguro — mensagens não serão re-enviadas automaticamente.
      getMessage: async (_key: proto.IMessageKey): Promise<{ conversation: string } | undefined> => {
        return undefined;
      },
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
          await this.updateSessionStatus(sessionId, tenantId, 'AWAITING_QR');
          internalEventBus.emit('SESSION_QR_UPDATED', { type: 'SESSION_QR_UPDATED', sessionId, tenantId, qrCode: qr });
          baileysLogger.info({ sessionId }, 'QR code updated');
        }

        if (connection === 'open') {
          this.registry.clearQr(sessionId);
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
          const { shouldReconnect, shouldClearCredentials, error } =
            translateDisconnect(sessionId, lastDisconnect?.error);
          baileysLogger.warn(
            { sessionId, shouldReconnect, shouldClearCredentials, errorCode: error.code },
            'Session disconnected',
          );

          // Current attempt count lives in the registry so a successful 'open' resets it.
          const currentAttempt = this.registry.getReconnectAttempt(sessionId);
          this.detachSocket(socket);
          this.registry.deleteIfCurrentEpoch(sessionId, epoch);
          this.clearSessionGroupMetadata(sessionId);
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

    // ── History sync ────────────────────────────────────────────────────────
    // ── Arquivamento de conversas ────────────────────────────────────────────
    // O WhatsApp entrega o estado de arquivamento em chats.upsert (sincronização
    // inicial) e chats.update (mudança feita em qualquer aparelho). É estado de
    // conversa, não histórico de mensagens, por isso não depende de
    // BAILEYS_SYNC_FULL_HISTORY.
    const emitArchiveState = (chatId: string | null | undefined, archived: boolean | null | undefined): void => {
      if (!chatId || archived === null || archived === undefined) return;
      if (chatId.endsWith('@broadcast') || chatId.endsWith('@lid')) return;

      const isGroup = chatId.endsWith('@g.us');
      internalEventBus.emit('CHAT_ARCHIVE_UPDATED', {
        type: 'CHAT_ARCHIVE_UPDATED',
        sessionId,
        tenantId,
        chatId: chatId.split('@')[0],
        isGroup,
        archived,
      });
    };

    socket.ev.on('messaging-history.set', ({ messages: histMsgs, chats: histChats }) => {
      if (isStale()) return;

      // O estado de arquivamento vem junto do history sync, e é o único momento em
      // que ele chega para sessões já pareadas — o chats.upsert acontece apenas na
      // sincronização inicial. Como é estado de conversa, não histórico de mensagens,
      // é processado independentemente de BAILEYS_SYNC_FULL_HISTORY.
      for (const chat of histChats ?? []) {
        emitArchiveState(chat.id, chat.archived);
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
            this.historySyncUseCase.execute({ tenantId, sessionId, messages: items });
          }
        } catch (err) {
          baileysLogger.warn({ err, sessionId }, 'Failed to process messaging-history.set');
        }
      });
    });

    socket.ev.on('chats.upsert', (chats) => {
      if (isStale()) return;
      for (const chat of chats) emitArchiveState(chat.id, chat.archived);
    });

    socket.ev.on('chats.update', (updates) => {
      if (isStale()) return;
      for (const update of updates) emitArchiveState(update.id, update.archived);
    });

    // ── Contacts upsert ──────────────────────────────────────────────────────
    socket.ev.on('contacts.upsert', (contacts) => {
      if (isStale()) return;
      setImmediate(() => {
        for (const c of contacts) {
          const rawJid = c.id;
          if (!rawJid || rawJid.endsWith('@g.us') || rawJid.endsWith('@broadcast')) continue;

          let phone: string;
          if (rawJid.endsWith('@lid')) {
            // LID: o Baileys pode fornecer o phoneNumber real no objeto Contact
            const phoneNumber = (c as { phoneNumber?: string }).phoneNumber;
            if (!phoneNumber) continue;
            phone = phoneNumber.replace(/\D/g, '');
            if (!phone) continue;
          } else {
            phone = rawJid.split('@')[0];
            if (!phone) continue;
          }

          // Só persiste quando temos um nome real — nunca sobrescrever com LID/phone como fallback
          const name = (c as { name?: string; notify?: string }).name
            ?? (c as { name?: string; notify?: string }).notify;
          if (!name || /^\d+$/.test(name)) continue;
          this.chatContactRepo
            .upsert({ tenantId, phone, name })
            .catch((err: unknown) =>
              baileysLogger.warn({ err, phone }, 'Failed to upsert contact from contacts.upsert'),
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

  /** Marks the session as needing a manual, user-initiated pairing. */
  private async parkAsLoggedOut(sessionId: string, tenantId: string): Promise<void> {
    await this.updateSessionStatus(sessionId, tenantId, 'LOGGED_OUT');
    internalEventBus.emit('SESSION_LOGGED_OUT', { type: 'SESSION_LOGGED_OUT', sessionId, tenantId });
  }

  private async updateSessionStatus(sessionId: string, tenantId: string, status: SessionStatus): Promise<void> {
    try {
      await this.sessionRepo.updateStatus(sessionId, tenantId, { status });
    } catch (err) {
      if (err instanceof SessionNotFoundError) return;
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
  } | null | undefined>;
  signalRepository?: {
    lidMapping?: {
      getPNForLID?: (lid: string) => Promise<string | null | undefined>;
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

/**
 * Garante que o MIME type seja mapeado para a extensão correta do arquivo de mídia.
 * Isso evita que o @fastify/static sirva áudio como video/mpeg (para .mpeg) ou
 * outros tipos incorretos que o browser recusa no elemento <audio>.
 */
const MIME_TO_EXT: Record<string, string> = {
  'audio/mpeg':   'mp3',
  'audio/mp3':    'mp3',
  'audio/mp4':    'm4a',
  'audio/x-m4a':  'm4a',
  'audio/aac':    'aac',
  'audio/ogg':    'ogg',
  'image/jpeg':   'jpg',
  'image/jpg':    'jpg',
  'video/mp4':    'mp4',
  'video/mpeg':   'mpeg',
};

function mimeTypeToExt(mimeType: string | null | undefined): string {
  if (!mimeType) return 'bin';
  const normalized = mimeType.split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[normalized] ?? normalized.split('/')[1]?.split(';')[0] ?? 'bin';
}

async function downloadBaileysMedia(
  msg: proto.IWebMessageInfo,
  socket: ReturnType<typeof makeWASocket>,
  sessionId: string,
  mimeType: string | null | undefined,
): Promise<string | null> {
  try {
    const ext = mimeTypeToExt(mimeType);
    const filename = `${sessionId}_${msg.key?.id ?? Date.now()}.${ext}`;

    if (await mediaFileExists(filename)) {
      return mediaPublicUrl(filename);
    }

    const buffer = (await downloadMediaMessage(
      msg as never,
      'buffer',
      {},
      { logger: baileysLogger as never, reuploadRequest: socket.updateMediaMessage },
    )) as Buffer;

    await saveMediaBuffer(buffer, filename);
    return mediaPublicUrl(filename);
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

  // Texto simples
  if (content.conversation) {
    return { msgType: ChatMessageType.TEXT, body: content.conversation, quotedMessageId, isDeleted };
  }
  if (content.extendedTextMessage?.text) {
    return { msgType: ChatMessageType.TEXT, body: content.extendedTextMessage.text, quotedMessageId, isDeleted };
  }

  // Imagem
  if (content.imageMessage) {
    return {
      msgType: ChatMessageType.IMAGE,
      body: content.imageMessage.caption ?? null,
      mimeType: content.imageMessage.mimetype ?? null,
      quotedMessageId,
      isDeleted,
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
