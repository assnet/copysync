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
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import type { ConnectionState, AnyMessageContent } from '@whiskeysockets/baileys';
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
  SendTextMessageInput,
  SendMediaMessageInput,
  SendMessageResult,
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

const RECONNECT_MAX_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 3_000;
const baileysLogger = appLogger.child({ module: 'baileys' });

export class BaileysMessagingEngineAdapter implements IMessagingEngine {
  private readonly registry = BaileysSessionRegistry.get();

  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly authStateRepo: ISessionAuthStateRepository,
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
    const existing = this.registry.get(sessionId);
    if (existing) {
      try { existing.socket.end(undefined); } catch { /* best-effort */ }
      this.registry.delete(sessionId);
    }
    await this.openSocket(sessionId, tenantId, 0);
    return {};
  }

  async disconnectSession(input: DisconnectSessionInput): Promise<void> {
    const { sessionId, tenantId } = input;
    const entry = this.registry.get(sessionId);
    if (entry) {
      try { entry.socket.end(undefined); } catch (err) {
        baileysLogger.warn({ err, sessionId }, 'Error closing socket on disconnect');
      }
      this.registry.delete(sessionId);
    }
    await this.updateSessionStatus(sessionId, tenantId, 'DISCONNECTED');
  }

  async reconnectSession(input: ReconnectSessionInput): Promise<void> {
    await this.connectSession({ sessionId: input.sessionId, tenantId: input.tenantId });
  }

  async logoutSession(input: LogoutSessionInput): Promise<void> {
    const { sessionId, tenantId } = input;
    const entry = this.registry.get(sessionId);
    if (entry) {
      try { await entry.socket.logout(); } catch (err) {
        baileysLogger.warn({ err, sessionId }, 'Error during Baileys logout');
      }
      entry.socket.end(undefined);
      this.registry.delete(sessionId);
    }
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
      printQRInTerminal: false,
      markOnlineOnConnect: false,
    });

    this.registry.set(sessionId, { socket, tenantId });
    internalEventBus.emit('SESSION_CONNECTING', { type: 'SESSION_CONNECTING', sessionId, tenantId });

    socket.ev.on('creds.update', async () => {
      try { await saveCreds(); }
      catch (err) { baileysLogger.error({ err, sessionId }, 'Failed to persist credentials'); }
    });

    socket.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.registry.setQr(sessionId, qr);
        await this.updateSessionStatus(sessionId, tenantId, 'AWAITING_QR');
        internalEventBus.emit('SESSION_QR_UPDATED', { type: 'SESSION_QR_UPDATED', sessionId, tenantId, qrCode: qr });
        baileysLogger.info({ sessionId }, 'QR code updated');
      }

      if (connection === 'open') {
        this.registry.clearQr(sessionId);
        const phone = state.creds.me?.id?.split(':')[0] ?? null;
        await this.sessionRepo.updateStatus(sessionId, tenantId, {
          status: 'CONNECTED',
          lastConnectedAt: new Date(),
        });
        if (phone) {
          try { await this.sessionRepo.updatePhone(sessionId, tenantId, phone); } catch { /* best-effort */ }
        }
        internalEventBus.emit('SESSION_CONNECTED', { type: 'SESSION_CONNECTED', sessionId, tenantId });
        baileysLogger.info({ sessionId, phone }, 'Session connected');
      }

      if (connection === 'close') {
        const { shouldReconnect, error } = translateDisconnect(sessionId, lastDisconnect?.error);
        baileysLogger.warn({ sessionId, shouldReconnect, errorCode: error.code }, 'Session disconnected');
        this.registry.delete(sessionId);
        internalEventBus.emit('SESSION_DISCONNECTED', {
          type: 'SESSION_DISCONNECTED', sessionId, tenantId, reason: error.code,
        });

        if (!shouldReconnect) {
          await this.updateSessionStatus(sessionId, tenantId, 'FAILED');
          return;
        }

        await this.updateSessionStatus(sessionId, tenantId, 'DISCONNECTED');

        const nextAttempt = attempt + 1;
        if (nextAttempt <= RECONNECT_MAX_ATTEMPTS) {
          const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt);
          baileysLogger.info({ sessionId, nextAttempt, delayMs: delay }, 'Scheduling auto-reconnect');
          setTimeout(() => {
            this.openSocket(sessionId, tenantId, nextAttempt).catch((err) => {
              baileysLogger.error({ err, sessionId }, 'Auto-reconnect failed');
            });
          }, delay);
        } else {
          baileysLogger.error({ sessionId }, 'Max reconnect attempts � marking FAILED');
          await this.updateSessionStatus(sessionId, tenantId, 'FAILED');
        }
      }
    });
    // ── Incoming messages ──────────────────────────────────────────────────
    socket.ev.on('messages.upsert', ({ messages, type }) => {
      // 'notify' = real-time new messages; 'append' = historical sync — skip
      if (type !== 'notify') return;

      for (const msg of messages) {
        const jid = msg.key?.remoteJid;
        if (!jid) continue;
        // Skip group chats and broadcast lists for now
        if (jid.endsWith('@g.us') || jid.endsWith('@broadcast')) continue;
        // Skip messages sent by us from the phone (not via API)
        if (msg.key.fromMe) continue;

        const from = jid.split('@')[0];
        const body =
          msg.message?.conversation ??
          msg.message?.extendedTextMessage?.text ??
          msg.message?.imageMessage?.caption ??
          msg.message?.videoMessage?.caption ??
          null;

        if (!body) continue; // non-text (sticker, audio, etc.) — handle later

        internalEventBus.emit('MESSAGE_RECEIVED', {
          type: 'MESSAGE_RECEIVED',
          sessionId,
          tenantId,
          from,
          fromName: msg.pushName ?? undefined,
          body,
          externalMessageId: msg.key.id ?? undefined,
          raw: msg,
        });

        baileysLogger.info({ sessionId, from, msgId: msg.key.id }, 'Incoming message received');
      }
    });  }

  private async updateSessionStatus(sessionId: string, tenantId: string, status: SessionStatus): Promise<void> {
    try {
      await this.sessionRepo.updateStatus(sessionId, tenantId, { status });
    } catch (err) {
      if (err instanceof SessionNotFoundError) return;
      baileysLogger.warn({ err, sessionId, status }, 'Failed to update session status');
    }
  }

  private requireConnectedEntry(sessionId: string) {
    const entry = this.registry.get(sessionId);
    if (!entry) throw new SessionNotConnectedError(sessionId);
    return entry;
  }

  private normalizeJid(phone: string): string {
    const clean = phone.replace(/[^0-9]/g, '');
    return clean.includes('@') ? phone : `${clean}@s.whatsapp.net`;
  }
}
