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
import { CURRENT_RULE_MEDIA_POLICY, type IIncomingMediaPolicy } from '../../../domain/contracts/IIncomingMediaPolicy';
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
import type { ISessionSocketControl } from '../../../domain/contracts/ISessionSocketControl';
import type { SessionStatus } from '../../../../sessions/domain/enums/SessionStatus';
import type { ISessionRepository } from '../../../../sessions/domain/contracts/ISessionRepository';
import type { IChatConversationRepository } from '../../../../chat/domain/contracts/IChatConversationRepository';
import { ChatMessageType } from '../../../../chat/domain/enums/ChatMessageEnums';
import { mimeTypeToExt } from '../../../../../shared/storage/mediaFileExtension';
import { SessionLeaseHeldError, SessionNotConnectedError, SessionNotFoundError } from '../../../../../shared/errors/internal/SessionErrors';
import { acquireLeaseResult, type ISessionLeaseGate, type LeaseAcquireResult } from '../../../../sessions/domain/contracts/ISessionLeaseRepository';
import type { SessionAbortOptions, SessionAdoptResult, SessionResumeResult } from '../../../domain/contracts/ISessionSocketControl';
import { openAuthStateTimeoutMs } from '../../../../sessions/domain/services/sessionLeasePolicy';
import { EngineOperationUnsupportedError, EngineTemporarilyUnavailableError, MessageSendFailedError } from '../../../../../shared/errors/internal/MessagingErrors';
import { GroupInviteNotAllowedError } from '../../../../../shared/errors/internal/GroupErrors';
import { TelegramLoginNotPendingError } from '../../../../../shared/errors/internal/TelegramErrors';
import { TelegramSessionRegistry, type PendingLogin, type TelegramSessionEntry } from './TelegramSessionRegistry';
import type { TelegramAuthStatePersistence } from './TelegramAuthStatePersistence';
import { Deferred } from './deferred';
import { mediaContainer } from '../../../../media/infrastructure/mediaContainer';
import { isAuthCancel, isLoggedOutError, translateTelegramLoginError, translateTelegramSendError } from './TelegramErrorTranslator';
import { composeTelegramMessageId, parseTelegramMessageId } from './telegramMessageId';
import { whatsappToTelegramHtml } from './whatsappToTelegramHtml';
import { TelegramChannelCatchUp } from './TelegramChannelCatchUp';
import type { IWatchedChannelSource } from '../../../domain/contracts/IWatchedChannelSource';

const telegramLogger = appLogger.child({ module: 'TelegramEngine' });
const ENGINE = 'telegram';
/** Foto baixada e servida pelo nosso storage; revalida a cada 6 h (como no WhatsApp). */
const PROFILE_PICTURE_TTL_MS = 6 * 60 * 60 * 1_000;
/** Cache da lista de dialogs por sessão (listagem de grupos). */
const DIALOGS_TTL_MS = 60_000;
/** Quanto a listagem de grupos espera pelas fotos que ainda faltam baixar. */
const GROUP_AVATAR_WAIT_MS = 3_000;
/** Mídia recebida acima disso não é baixada (vídeo/arquivo grande): a mensagem entra sem `mediaUrl`. */
export const TELEGRAM_INBOUND_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
const PARSE_MODE = 'html';

export interface TelegramEngineConfig {
  apiId: number;
  apiHash: string;
  /** Recuperação ativa de canais monitorados (`TELEGRAM_CHANNEL_CATCHUP_ENABLED`). Padrão: desligada. */
  channelCatchUp?: boolean;
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

/** Recebe o resultado do acquire do lease em `openClient` (retomada distingue held de erro). */
interface LeaseProbe {
  lease?: LeaseAcquireResult;
}

/**
 * Uma abertura de cliente em curso. Abort/suspend (entre o acquire e o `registry.set`) e uma
 * abertura nova do usuário (`supersede`, desde o início) marcam `cancelled`; a abertura desiste sem
 * registrar. Precedência: abort > suspend > supersede.
 */
interface OpeningToken {
  cancelled: 'abort' | 'suspend' | 'supersede' | null;
  /** Quem pediu a abertura: o abort `onlyAuto` (desistência da retomada) não cancela a do usuário. */
  origin: 'user' | 'auto';
}

/**
 * Carga da StringSession com prazo por origem (15 s automática, 60 s usuário, como no Baileys):
 * banco mudo vira erro transitório em vez de prender a abertura. A carga perdida é descartada.
 */
async function loadWithDeadline<T>(load: Promise<T>, origin: 'user' | 'auto'): Promise<T> {
  load.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EngineTemporarilyUnavailableError()), openAuthStateTimeoutMs(origin));
  });
  try {
    return await Promise.race([load, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** `openClient` em curso por sessão: a próxima abertura espera (auto) ou a cancela (usuário). */
interface OpenInFlight {
  promise: Promise<TelegramSessionEntry | null>;
  token: OpeningToken;
}

export class TelegramMessagingEngineAdapter implements IMessagingEngine, ISessionSocketControl {
  private readonly registry = new TelegramSessionRegistry();
  /** Sessões suspensas por fence de banco → tenant, para `resumeSession` reabrir. */
  private readonly suspended = new Map<string, string>();
  /** Reabertura em curso por `resumeSession`: connect/disconnect/logout/abort a invalidam. */
  private readonly resuming = new Map<string, object>();
  /**
   * Aberturas entre `leaseGate.acquire` e `registry.set`: a renovação as trata como locais.
   * Abort/suspend nesse intervalo marcam `cancelled` (abort vence suspend) e a abertura desiste.
   */
  private readonly opening = new Map<string, Set<OpeningToken>>();
  /** Uma abertura por sessão: nunca dois clientes abrindo (ver `openClient`). */
  private readonly openInFlight = new Map<string, OpenInFlight>();
  private readonly profilePictureCache = new Map<string, { url: string | null; at: number }>();
  private readonly dialogsCache = new Map<string, { dialogs: Awaited<ReturnType<TelegramClient['getDialogs']>>; client: TelegramClient; at: number }>();
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
    /** Lease da sessão (LEASE-03): sem ele nenhum cliente abre. Padrão: sempre concede. */
    private readonly leaseGate: ISessionLeaseGate = { acquire: async () => true },
    /** Canais monitorados da sessão, para a recuperação de posts que o Telegram não empurrou. */
    private readonly watchedChannels?: IWatchedChannelSource,
    /** Download de mídia recebida (entrega D). Padrão: regra atual (`shouldDownloadMedia`). */
    private readonly mediaPolicy: IIncomingMediaPolicy = CURRENT_RULE_MEDIA_POLICY,
  ) {}

  // ── Ciclo de vida ──────────────────────────────────────────────────────────

  async createSession(input: CreateSessionInput): Promise<void> {
    internalEventBus.emit('SESSION_CREATED', { type: 'SESSION_CREATED', sessionId: input.sessionId, tenantId: input.tenantId });
  }

  /** Abre o cliente; com credenciais salvas conecta direto, sem elas inicia o login por QR. */
  async connectSession(input: ConnectSessionInput): Promise<ConnectSessionResult> {
    this.dropSuspension(input.sessionId);
    const entry = await this.openClient(input.sessionId, input.tenantId);
    // Clique repetido: a abertura mais nova cancelou esta e segue sozinha
    if (!entry) return {};
    if (await entry.client.checkAuthorization()) {
      await this.finishLogin(input.sessionId, entry);
      return {};
    }
    this.startQrLogin(input.sessionId, entry);
    return {};
  }

  async reconnectSession(input: ReconnectSessionInput): Promise<void> {
    this.dropSuspension(input.sessionId);
    await this.reopen(input);
  }

  /**
   * Reconexão (manual = `user`, retomada pós-fence = `auto`); `probe` recebe o resultado do acquire
   * do lease. `false` = não abriu aqui (cancelada por abertura do usuário ou outra já em curso).
   */
  private async reopen(input: ReconnectSessionInput, origin: 'user' | 'auto' = 'user', probe?: LeaseProbe): Promise<boolean> {
    const saved = await loadWithDeadline(this.auth.load(input.sessionId, input.tenantId), origin);
    if (!saved) {
      // Nunca logou (ou saiu): como no WhatsApp, reconectar sem credencial abre o login por QR
      const entry = await this.openClient(input.sessionId, input.tenantId, null, probe, origin);
      if (!entry) return false;
      this.startQrLogin(input.sessionId, entry);
      return true;
    }
    const entry = await this.openClient(input.sessionId, input.tenantId, saved, probe, origin);
    if (!entry) return false;
    if (await entry.client.checkAuthorization()) {
      await this.finishLogin(input.sessionId, entry);
      return true;
    }
    await this.auth.clear(input.sessionId);
    await this.teardown(input.sessionId, entry);
    await this.updateStatus(input.sessionId, input.tenantId, 'LOGGED_OUT');
    internalEventBus.emit('SESSION_LOGGED_OUT', { type: 'SESSION_LOGGED_OUT', sessionId: input.sessionId, tenantId: input.tenantId });
    return true;
  }

  async disconnectSession(input: DisconnectSessionInput): Promise<void> {
    this.dropSuspension(input.sessionId);
    const entry = this.registry.get(input.sessionId);
    if (entry) await this.teardown(input.sessionId, entry);
    await this.sessionRepo
      .updateStatus(input.sessionId, input.tenantId, { status: 'DISCONNECTED', lastDisconnectedAt: new Date() })
      .catch(() => undefined);
    internalEventBus.emit('SESSION_DISCONNECTED', { type: 'SESSION_DISCONNECTED', sessionId: input.sessionId, tenantId: input.tenantId, reason: 'manual' });
  }

  async logoutSession(input: LogoutSessionInput): Promise<void> {
    this.dropSuspension(input.sessionId);
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
    // Pedido mais novo cancelou este (mesmo efeito de hoje para o login trocado: cancelado)
    if (!entry) throw translateTelegramLoginError(new Error('AUTH_USER_CANCEL'));
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

  /**
   * Uma abertura por sessão, como no Baileys: com outra em curso, a do usuário a cancela
   * (`supersede`), espera ela assentar e abre a sua (cliques repetidos viram um cliente, sem fila
   * serial atrás de uma retomada pendurada); a automática espera a em curso e devolve `null` (não
   * abre um 2º cliente). `null` também = esta abertura foi cancelada por uma do usuário.
   */
  private async openClient(
    sessionId: string, tenantId: string, savedSession?: string | null, probe?: LeaseProbe,
    origin: 'user' | 'auto' = 'user',
  ): Promise<TelegramSessionEntry | null> {
    for (let running = this.openInFlight.get(sessionId); running; running = this.openInFlight.get(sessionId)) {
      if (origin === 'auto') {
        await running.promise.catch(() => undefined);
        return null;
      }
      if (!running.token.cancelled) running.token.cancelled = 'supersede';
      await running.promise.catch(() => undefined);
    }
    const token: OpeningToken = { cancelled: null, origin };
    const flight: OpenInFlight = { promise: this.openClientOnce(sessionId, tenantId, token, savedSession, probe), token };
    this.openInFlight.set(sessionId, flight);
    try {
      return await flight.promise;
    } finally {
      if (this.openInFlight.get(sessionId) === flight) this.openInFlight.delete(sessionId);
    }
  }

  private async openClientOnce(
    sessionId: string, tenantId: string, token: OpeningToken, savedSession?: string | null, probe?: LeaseProbe,
  ): Promise<TelegramSessionEntry | null> {
    // Lease antes de tudo (LEASE-03): outro processo com a sessão → nenhum cliente nem status aqui
    // (dois clientes com a mesma chave = AUTH_KEY_DUPLICATED). Erro de banco ≠ outro dono.
    const lease = await acquireLeaseResult(this.leaseGate, sessionId);
    if (probe) probe.lease = lease;
    if (lease !== 'acquired') {
      telegramLogger.warn({ sessionId, tenantId, lease }, 'lease da sessão não adquirido; cliente não aberto');
      throw lease === 'held' ? new SessionLeaseHeldError(sessionId) : new EngineTemporarilyUnavailableError();
    }
    // Entre o acquire e o registry.set a sessão conta como local, senão a renovação larga o lease
    const opened = await this.whileOpening(sessionId, token, async () => {
      // Cancelada ainda no acquire (supersede/abort): nem carrega nem cria cliente
      if (token.cancelled) return token.cancelled;
      const existing = this.registry.get(sessionId);
      if (existing) await this.teardown(sessionId, existing);

      // Prazo estourado lança aqui (não cancelado): o whileOpening solta o lease
      const saved = savedSession === undefined
        ? await loadWithDeadline(this.auth.load(sessionId, tenantId), token.origin)
        : savedSession;
      if (token.cancelled) return token.cancelled;
      const client = new TelegramClient(new StringSession(saved ?? ''), this.config.apiId, this.config.apiHash, {
        connectionRetries: 5,
        autoReconnect: true,
        baseLogger: new Logger(LogLevel.ERROR),
        deviceModel: 'CopySync Web',
        appVersion: '1.0',
      });
      // Entrada viva de outro cliente (registrada durante a carga): derruba antes de sobrescrever
      const stale = this.registry.get(sessionId);
      if (stale) await this.teardown(sessionId, stale);
      // Abort/suspend/supersede chegou enquanto abria: descarta o cliente (nunca conectado) antes de expor
      if (token.cancelled) {
        try { await client.destroy(); } catch { /* best-effort */ }
        return token.cancelled;
      }
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
      return entry;
    });
    if (opened === 'supersede') {
      // A abertura nova do usuário usa a mesma StringSession: nada a gravar nem soltar aqui
      telegramLogger.info({ sessionId }, 'Telegram client open superseded by a newer open');
      return null;
    }
    if (typeof opened === 'string') {
      // Sem status nem StringSession; suspensa volta pelo resumeSession
      if (opened === 'suspend') this.suspended.set(sessionId, tenantId);
      // Acquire que assentou depois do abort (a desistência já soltou): solta de novo, condicionado ao dono
      if (opened === 'abort' && !this.registry.get(sessionId) && !this.hasLiveOpen(sessionId, token)) {
        await this.releaseLeaseAfterFailedOpen(sessionId);
      }
      telegramLogger.warn({ sessionId, kind: opened }, 'Telegram client open cancelled by lease');
      throw new SessionLeaseHeldError(sessionId);
    }
    const entry = opened;
    // Abort/suspend logo após o registro já derrubou o cliente: nada de status
    if (!this.registry.isCurrent(sessionId, entry.epoch)) throw new SessionLeaseHeldError(sessionId);
    await this.updateStatus(sessionId, tenantId, 'CONNECTING');
    internalEventBus.emit('SESSION_CONNECTING', { type: 'SESSION_CONNECTING', sessionId, tenantId });
    try {
      await entry.client.connect();
    } catch (err) {
      // Cliente derrubado por abort/suspend durante o connect: não grava FAILED nem mexe no lease
      if (!this.registry.isCurrent(sessionId, entry.epoch)) throw new SessionLeaseHeldError(sessionId);
      this.registry.delete(sessionId);
      await this.updateStatus(sessionId, tenantId, 'FAILED');
      if (!this.opening.has(sessionId)) await this.releaseLeaseAfterFailedOpen(sessionId);
      throw translateTelegramLoginError(err);
    }
    return entry;
  }

  private async finishLogin(sessionId: string, entry: TelegramSessionEntry): Promise<void> {
    if (!this.registry.isCurrent(sessionId, entry.epoch)) return;
    entry.authorized = true;
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
    // Lease perdido (abortSession) durante o getMe: não marca CONNECTED nem escuta mensagens
    if (!this.registry.isCurrent(sessionId, entry.epoch)) return;
    client.addEventHandler((event: NewMessageEvent) => {
      void this.onNewMessage(sessionId, entry, event);
    }, new NewMessage({}));
    this.startChannelCatchUp(sessionId, entry);

    await this.sessionRepo
      .updateStatus(sessionId, tenantId, { status: 'CONNECTED', lastConnectedAt: new Date() })
      .catch(() => undefined);
    internalEventBus.emit('SESSION_CONNECTED', { type: 'SESSION_CONNECTED', sessionId, tenantId });
    telegramLogger.info({ sessionId, phone: entry.phone }, 'Telegram session connected');
    pending?.waiter?.resolve({ status: 'CONNECTED' });
    if (pending) pending.waiter = null;
  }

  /** Canais monitorados que o Telegram deixou de empurrar: ver `TelegramChannelCatchUp`. */
  private startChannelCatchUp(sessionId: string, entry: TelegramSessionEntry): void {
    if (!this.config.channelCatchUp || !this.watchedChannels || entry.catchUp) return;
    const catchUp = new TelegramChannelCatchUp({
      sessionId,
      tenantId: entry.tenantId,
      client: entry.client,
      source: this.watchedChannels,
      logger: telegramLogger,
      onMessage: (msg) => this.handleIncoming(sessionId, entry, msg, () => msg.getChat()),
    });
    entry.catchUp = catchUp;
    catchUp.start();
  }

  private async teardown(sessionId: string, entry: TelegramSessionEntry): Promise<void> {
    entry.catchUp?.stop();
    entry.catchUp = null;
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
    const chatId = peerString(event.message.peerId);
    if (chatId) entry.catchUp?.notePush(chatId);
    await this.handleIncoming(sessionId, entry, event.message, () => event.getChat());
  }

  /** Push (`NewMessage`) e recuperação de canal entram aqui; o id repetido é descartado. */
  private async handleIncoming(sessionId: string, entry: TelegramSessionEntry, msg: Api.Message, getChat: () => Promise<unknown>): Promise<void> {
    if (!this.registry.isCurrent(sessionId, entry.epoch)) return;
    const chatId = peerString(msg.peerId);
    if (!chatId) return;
    const externalMessageId = composeTelegramMessageId(chatId, msg.id);
    if (!this.registry.markSeen(entry, externalMessageId)) return;
    const fromMe = Boolean(msg.out);
    if (fromMe && entry.sentIds.has(externalMessageId)) return; // eco do que acabamos de enviar

    const isGroup = chatId.startsWith('-');
    const senderId = peerString(msg.fromId) ?? (fromMe ? entry.phone ?? 'me' : chatId);

    let chatName: string | undefined;
    let senderName: string | undefined;
    try {
      chatName = displayName(await getChat());
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
    const mediaUrl = msgType !== ChatMessageType.TEXT && await this.mediaPolicy.shouldDownload(
      { tenantId: entry.tenantId, sessionId, isGroup, groupJid: isGroup ? chatId : null, msgType, fromMe },
      () => this.shouldDownloadMedia(sessionId, entry.tenantId, isGroup ? chatId : null),
    )
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
  async createOutboundMessageId(sessionId: string): Promise<string> {
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
    const dialogs = await this.cachedDialogs(sessionId, entry);
    const out: ParticipatingGroupInfo[] = [];
    const avatarOf = new Map<number, Promise<string | null>>();
    for (const d of dialogs) {
      if (!d.isGroup && !d.isChannel) continue;
      const ent = d.entity as Api.Channel | Api.Chat | undefined;
      // Todos os grupos e canais ativos: canal só de leitura serve para monitorar (canPost=false)
      if (ent instanceof Api.Chat && (ent.left || ent.deactivated)) continue;
      if (ent instanceof Api.Channel && ent.left) continue;
      if (!d.id) continue;
      out.push({
        groupJid: d.id.toString(),
        name: d.title ?? null,
        avatarUrl: null,
        ...telegramGroupPermissions(ent),
      });
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

  /**
   * Dialogs da sessão com cache curto: a lista de grupos é lida por várias telas (seletor, configs
   * salvas do monitor e do gerador) e não pode martelar o Telegram (FLOOD_WAIT).
   */
  private async cachedDialogs(sessionId: string, entry: TelegramSessionEntry) {
    const hit = this.dialogsCache.get(sessionId);
    if (hit && hit.client === entry.client && Date.now() - hit.at < DIALOGS_TTL_MS) return hit.dialogs;
    const dialogs = await entry.client.getDialogs({ limit: 500 });
    this.dialogsCache.set(sessionId, { dialogs, client: entry.client, at: Date.now() });
    return dialogs;
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
      // Link do Telegram é `https://t.me/+<code>`; devolve só o código (quem monta a URL sabe o
      // canal). O formato antigo `t.me/joinchat/<code>` vira `+<code>` (mesmo convite).
      const code = link.replace(/^https?:\/\/(?:www\.)?(?:t|telegram)\.me\//i, '').replace(/^joinchat\//i, '+');
      if (!code) throw new GroupInviteNotAllowedError();
      return { inviteCode: code };
    } catch (err) {
      // Sem ser admin com permissão de convidar o Telegram responde CHAT_ADMIN_REQUIRED (ou
      // CHAT_ADMIN_INVITE_REQUIRED): o rodízio pede o link manual em vez de tratar como queda.
      if (/CHAT_ADMIN_(?:INVITE_)?REQUIRED|CHAT_WRITE_FORBIDDEN/.test(String((err as { errorMessage?: string })?.errorMessage ?? ''))) {
        throw new GroupInviteNotAllowedError();
      }
      throw translateTelegramSendError(err);
    }
  }

  async getGroupSummary(sessionId: string, groupJid: string): Promise<{ name: string; memberCount: number; isSelfAdmin: boolean }> {
    const entry = this.requireConnected(sessionId);
    try {
      const ent = await entry.client.getEntity(await this.inputPeer(entry, groupJid));
      // Supergrupo e canal: contagem real vem do GetFullChannel (a entidade não traz)
      if (ent instanceof Api.Channel) {
        const full = await entry.client.invoke(new Api.channels.GetFullChannel({ channel: ent }));
        const count = full.fullChat instanceof Api.ChannelFull ? full.fullChat.participantsCount ?? 0 : 0;
        return { name: ent.title, memberCount: count, isSelfAdmin: Boolean(ent.creator || ent.adminRights) };
      }
      if (ent instanceof Api.Chat) {
        return { name: ent.title, memberCount: ent.participantsCount, isSelfAdmin: Boolean(ent.creator || ent.adminRights) };
      }
    } catch (err) {
      throw translateTelegramSendError(err);
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

  // ── Lease de sessão (ISessionSocketControl) ────────────────────────────────

  /**
   * Lease perdido: destrói o cliente e cancela o login pendente sem gravar status nem
   * StringSession (o fluxo de login sai pelo `isCurrent` falso). Sem cliente local: nada.
   */
  async abortSession(sessionId: string, options?: SessionAbortOptions): Promise<void> {
    // Desistência da retomada: abertura do usuário em voo segue intacta
    if (options?.onlyAuto && this.hasUserOpen(sessionId)) {
      telegramLogger.info({ sessionId }, 'abort da desistência ignorado (abertura do usuário em voo)');
      return;
    }
    this.dropSuspension(sessionId);
    this.dialogsCache.delete(sessionId);
    this.cancelOpening(sessionId, 'abort');
    const entry = this.registry.get(sessionId);
    if (!entry) return;
    await this.teardown(sessionId, entry);
    telegramLogger.warn({ sessionId }, 'Telegram client aborted (lease lost)');
  }

  /**
   * Fence por erro de banco: destrói o cliente sem `auth.clear` nem gravar status (a
   * StringSession salva continua valendo) e lembra o tenant para `resumeSession`.
   */
  async suspendSession(sessionId: string): Promise<void> {
    this.dialogsCache.delete(sessionId);
    // Em abertura: a própria abertura desiste e marca suspensa (ver openClient)
    this.cancelOpening(sessionId, 'suspend');
    const entry = this.registry.get(sessionId);
    if (!entry) return;
    this.suspended.set(sessionId, entry.tenantId);
    await this.teardown(sessionId, entry);
    telegramLogger.warn({ sessionId }, 'Telegram client suspended (lease fence, database unavailable)');
  }

  /**
   * Banco de volta: reabre a sessão suspensa pelo caminho de reconexão (lease → cliente). A entrada
   * de `suspended` só sai no sucesso; `held` (só se o acquire disse held) e erro a mantêm.
   */
  async resumeSession(sessionId: string): Promise<SessionResumeResult> {
    const tenantId = this.suspended.get(sessionId);
    if (tenantId === undefined) return 'gone';
    if (this.registry.get(sessionId)) {
      this.suspended.delete(sessionId);
      return 'resumed';
    }
    const attempt = {};
    this.resuming.set(sessionId, attempt);
    // Abort/connect/disconnect/logout no meio invalidam a tentativa (forgetSuspension)
    const current = (): boolean => this.resuming.get(sessionId) === attempt;
    const probe: LeaseProbe = {};
    try {
      const opened = await this.reopen({ sessionId, tenantId }, 'auto', probe);
      if (!current()) return 'gone';
      // Outra abertura cuidou (ou cancelou esta): só vale como retomada se deixou cliente aqui
      if (!opened && !this.registry.get(sessionId)) throw new EngineTemporarilyUnavailableError();
      this.suspended.delete(sessionId);
      return 'resumed';
    } catch (err) {
      if (!current()) return 'gone';
      if (probe.lease === 'held') return 'held';
      throw err;
    } finally {
      if (current()) this.resuming.delete(sessionId);
    }
  }

  /**
   * Adoção (ADOPT-07): reabre pela origem automática (prazo de 15 s) sem lançar. `held` só se o
   * acquire disse held (outro dono ou teto); cancelada (abort/suspend/usuário) sem cliente aqui.
   */
  async adoptSession(sessionId: string, tenantId: string): Promise<SessionAdoptResult> {
    if (this.registry.get(sessionId)) return 'opened';
    const probe: LeaseProbe = {};
    try {
      await this.reopen({ sessionId, tenantId }, 'auto', probe);
      // Sem cliente aqui: cancelada por outra abertura, ou credencial revogada (LOGGED_OUT)
      return this.registry.get(sessionId) ? 'opened' : 'cancelled';
    } catch (err) {
      if (probe.lease === 'held') return 'held';
      // Acquire concedido e abertura cancelada por abort/suspend (lança held depois do acquire)
      if (probe.lease === 'acquired' && err instanceof SessionLeaseHeldError) return 'cancelled';
      telegramLogger.warn({ err, sessionId, tenantId }, 'abertura da sessão adotada falhou');
      return 'error';
    }
  }

  /** Desistência do use case (ver contrato); devolve o tenant que a suspensão guardava. */
  async forgetSuspension(sessionId: string): Promise<string | null> {
    return this.dropSuspension(sessionId);
  }

  /** Ação explícita sobre a sessão: apaga a suspensão e invalida reabertura em curso. */
  private dropSuspension(sessionId: string): string | null {
    const tenantId = this.suspended.get(sessionId) ?? null;
    this.suspended.delete(sessionId);
    this.resuming.delete(sessionId);
    return tenantId;
  }

  /** Shutdown: destrói todos os clientes em paralelo; falha de um não segura os outros. */
  async closeAllSockets(): Promise<void> {
    await Promise.allSettled(this.registry.all().map(([id, entry]) => this.teardown(id, entry)));
  }

  listLocalSessionIds(): string[] {
    const ids = new Set(this.registry.all().map(([id]) => id));
    for (const id of this.opening.keys()) ids.add(id);
    return [...ids];
  }

  /** Clientes com login concluído (`finishLogin`); login por QR/código em andamento fica fora. */
  listAuthenticatedSessionIds(): string[] {
    return this.registry.all().filter(([, entry]) => entry.authorized).map(([id]) => id);
  }

  async hasStoredCredentials(sessionId: string): Promise<boolean> {
    return this.auth.hasSaved(sessionId);
  }

  /**
   * Marca a sessão como "abrindo" enquanto `open` roda (sai no fim, com sucesso ou falha). Erro
   * não cancelado depois do acquire solta o lease (best-effort), se nada mais desta sessão
   * estiver aberto ou abrindo aqui; sem isso o lease ficaria preso até o TTL.
   */
  private async whileOpening<T>(
    sessionId: string, token: OpeningToken, open: () => Promise<T>,
  ): Promise<T> {
    const tokens = this.opening.get(sessionId) ?? new Set<OpeningToken>();
    tokens.add(token);
    this.opening.set(sessionId, tokens);
    try {
      return await open();
    } catch (err) {
      if (!token.cancelled && tokens.size === 1 && !this.registry.get(sessionId)) {
        await this.releaseLeaseAfterFailedOpen(sessionId);
      }
      throw err;
    } finally {
      tokens.delete(token);
      if (tokens.size === 0 && this.opening.get(sessionId) === tokens) this.opening.delete(sessionId);
    }
  }

  /**
   * Abort/suspend durante a abertura. Abort pega também a abertura ainda no acquire
   * (`openInFlight`, fora de `opening`): a desistência da retomada solta o lease logo depois.
   */
  /** Abertura do usuário em voo: token `user` não cancelado, ou automática já marcada `supersede`. */
  private hasUserOpen(sessionId: string): boolean {
    for (const token of this.openTokens(sessionId)) {
      if (token.cancelled === 'supersede' || (token.origin === 'user' && !token.cancelled)) return true;
    }
    return false;
  }

  /** Outra abertura desta sessão ainda viva (não cancelada), além de `self`. */
  private hasLiveOpen(sessionId: string, self: OpeningToken): boolean {
    for (const token of this.openTokens(sessionId)) if (token !== self && !token.cancelled) return true;
    return false;
  }

  private openTokens(sessionId: string): Set<OpeningToken> {
    const tokens = new Set(this.opening.get(sessionId) ?? []);
    const inFlight = this.openInFlight.get(sessionId)?.token;
    if (inFlight) tokens.add(inFlight);
    return tokens;
  }

  private cancelOpening(sessionId: string, kind: 'abort' | 'suspend'): void {
    const tokens = new Set(this.opening.get(sessionId) ?? []);
    const inFlight = this.openInFlight.get(sessionId)?.token;
    if (kind === 'abort' && inFlight) tokens.add(inFlight);
    for (const token of tokens) {
      if (kind === 'abort' || !token.cancelled || token.cancelled === 'supersede') token.cancelled = kind;
    }
  }

  private async releaseLeaseAfterFailedOpen(sessionId: string): Promise<void> {
    try {
      await this.leaseGate.release?.(sessionId);
    } catch (err) {
      telegramLogger.warn({ err, sessionId }, 'falha ao soltar lease após abertura com erro');
    }
  }

  /** Encerra todos os clientes (shutdown do processo). */
  async shutdown(): Promise<void> {
    await Promise.all(this.registry.all().map(([id, entry]) => this.teardown(id, entry)));
  }
}

/**
 * A conta pode postar? Canal (broadcast): só criador ou admin com `postMessages`. Grupo/supergrupo:
 * não só quando o envio está bloqueado por padrão e a conta não é criadora nem admin.
 */
/**
 * Gerar link de convite (`ExportChatInvite`) exige ser criador ou admin com `inviteUsers`, em
 * grupo, supergrupo ou canal. Sem isso o rodízio não consegue o convite sozinho.
 */
function telegramCanInvite(ent: unknown): boolean {
  if (ent instanceof Api.Channel || ent instanceof Api.Chat) return Boolean(ent.creator || ent.adminRights?.inviteUsers);
  return false;
}

/** Permissões com motivo: canal de transmissão → CHANNEL_READONLY; grupo com envio banido → ADMINS_ONLY. */
export function telegramGroupPermissions(ent: unknown): Pick<ParticipatingGroupInfo, 'canPost' | 'postBlockedReason' | 'canInvite' | 'inviteBlockedReason'> {
  const canPost = telegramCanPost(ent);
  const canInvite = telegramCanInvite(ent);
  const broadcast = ent instanceof Api.Channel && !!ent.broadcast;
  return {
    canPost,
    postBlockedReason: canPost ? null : broadcast ? 'CHANNEL_READONLY' : 'ADMINS_ONLY',
    canInvite,
    inviteBlockedReason: canInvite ? null : 'NOT_ADMIN',
  };
}

function telegramCanPost(ent: unknown): boolean {
  if (ent instanceof Api.Channel) {
    if (ent.creator) return true;
    if (ent.broadcast) return !!ent.adminRights?.postMessages;
    return !ent.defaultBannedRights?.sendMessages || !!ent.adminRights;
  }
  if (ent instanceof Api.Chat) {
    if (ent.creator || ent.adminRights) return true;
    return !ent.defaultBannedRights?.sendMessages;
  }
  return true;
}
