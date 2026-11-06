/**
 * TelegramChannelCatchUp
 *
 * O Telegram não garante empurrar post de canal/supergrupo para conta de usuário ("may stop sending
 * updates (or send fewer updates) for some channels", core.telegram.org/api/updates) e a GramJS não
 * recupera lacuna (`catchUp()` é TODO). Sem isto, canal monitorado fica sem nenhuma captura.
 *
 * Custo contido de propósito:
 * - só canais **monitorados** da sessão (`IWatchedChannelSource`, até `MAX_CHANNELS`), nunca todos os dialogs;
 * - canal com push recente (`notePush`) não é consultado: o push está vivo;
 * - uma consulta `updates.getChannelDifference` por canal a cada `BASE_INTERVAL_MS`, ou o `timeout`
 *   que o próprio Telegram devolver, o que for maior; resposta vazia é barata (só o pts);
 * - consultas em série (um canal por vez); `FLOOD_WAIT` pausa a sessão inteira pelo prazo pedido;
 * - lista de canais relida do banco a cada `WATCH_REFRESH_MS`.
 *
 * Estado (pts por canal) é só cache: some no restart e é refeito pelo Telegram (`GetFullChannel`).
 * Mensagem anterior ao início do acompanhamento do canal não é reemitida (sem backfill).
 */
import { Api } from 'telegram';
import { getPeerId } from 'telegram/Utils';
import type { IWatchedChannelSource } from '../../../domain/contracts/IWatchedChannelSource';

export const CATCHUP_BASE_INTERVAL_MS = 60_000;
export const CATCHUP_PUSH_FRESH_MS = 90_000;
export const CATCHUP_WATCH_REFRESH_MS = 5 * 60_000;
export const CATCHUP_MAX_CHANNELS = 10;
const MAX_PAGES = 3;
const PAGE_LIMIT = 100;

/** O que a recuperação usa do cliente (o `TelegramClient` atende). */
export interface CatchUpClient {
  invoke<R extends Api.AnyRequest>(request: R): Promise<R['__response']>;
  getInputEntity(peer: Api.TypeEntityLike): Promise<Api.TypeInputPeer>;
  getDialogs(params: { limit: number }): Promise<unknown>;
}

export interface CatchUpLogger {
  debug(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

interface ChannelState {
  input: Api.InputChannel;
  pts: number;
  /** Epoch ms: mensagem com data anterior não é reemitida. */
  since: number;
  nextAt: number;
}

export interface ChannelCatchUpOptions {
  sessionId: string;
  tenantId: string;
  client: CatchUpClient;
  source: IWatchedChannelSource;
  /** Mensagem recuperada (já com client/entidades). Dedupe contra o push fica com quem recebe. */
  onMessage: (msg: Api.Message) => Promise<void>;
  logger: CatchUpLogger;
  now?: () => number;
  baseIntervalMs?: number;
}

/** Canal deve ser consultado agora? Pura: sem push recente e já passou do próximo horário. */
export function isChannelDue(nextAt: number, lastPushAt: number | undefined, now: number, pushFreshMs = CATCHUP_PUSH_FRESH_MS): boolean {
  if (now < nextAt) return false;
  return lastPushAt === undefined || now - lastPushAt >= pushFreshMs;
}

/** Próxima consulta: o maior entre o intervalo base e o `timeout` (s) sugerido pelo Telegram. */
export function nextPollAt(now: number, timeoutSeconds: number | undefined, baseMs = CATCHUP_BASE_INTERVAL_MS): number {
  return now + Math.max(baseMs, (timeoutSeconds ?? 0) * 1_000);
}

function floodSeconds(err: unknown): number | null {
  const s = (err as { seconds?: unknown } | null)?.seconds;
  return typeof s === 'number' && s > 0 ? s : null;
}

/** Canal sumiu para a conta (saiu, banido, privado): para de consultar até a próxima releitura. */
function isChannelGone(err: unknown): boolean {
  const m = (err as { errorMessage?: unknown } | null)?.errorMessage;
  return typeof m === 'string' && /^(CHANNEL_PRIVATE|CHANNEL_INVALID|CHAT_FORBIDDEN|USER_BANNED_IN_CHANNEL)/.test(m);
}

export class TelegramChannelCatchUp {
  private readonly channels = new Map<string, ChannelState>();
  private readonly lastPush = new Map<string, number>();
  /** Canais que falharam ao resolver: só tenta de novo na próxima releitura da lista. */
  private readonly skipped = new Set<string>();
  private watched: string[] = [];
  private watchedAt = -Infinity;
  private pausedUntil = 0;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;
  private dialogsLoaded = false;
  private readonly now: () => number;
  private readonly baseMs: number;

  constructor(private readonly opts: ChannelCatchUpOptions) {
    this.now = opts.now ?? Date.now;
    this.baseMs = opts.baseIntervalMs ?? CATCHUP_BASE_INTERVAL_MS;
  }

  start(): void {
    if (this.stopped || this.timer) return;
    this.schedule(this.baseMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Push chegou deste chat: o canal não precisa de consulta agora. */
  notePush(chatId: string): void {
    this.lastPush.set(chatId, this.now());
  }

  /** Uma rodada (exposta para teste). Nunca lança. */
  async tick(): Promise<void> {
    if (this.stopped || this.running) return this.running ?? undefined;
    this.running = this.round().finally(() => { this.running = null; });
    return this.running;
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick().finally(() => this.schedule(this.baseMs));
    }, ms);
    this.timer.unref?.();
  }

  private async round(): Promise<void> {
    const now = this.now();
    if (now < this.pausedUntil) return;
    try {
      await this.refreshWatched(now);
      for (const jid of this.watched) {
        if (this.stopped || this.now() < this.pausedUntil) return;
        if (this.skipped.has(jid)) continue;
        await this.pollChannel(jid);
      }
    } catch (err) {
      this.opts.logger.warn({ err, sessionId: this.opts.sessionId }, 'Telegram channel catch-up round failed');
    }
  }

  private async refreshWatched(now: number): Promise<void> {
    if (now - this.watchedAt < CATCHUP_WATCH_REFRESH_MS) return;
    this.watchedAt = now;
    this.watched = await this.opts.source.listWatchedChannels(this.opts.tenantId, this.opts.sessionId, CATCHUP_MAX_CHANNELS);
    const keep = new Set(this.watched);
    for (const jid of this.channels.keys()) if (!keep.has(jid)) this.channels.delete(jid);
    this.skipped.clear();
  }

  private async pollChannel(jid: string): Promise<void> {
    const state = this.channels.get(jid);
    if (state && !isChannelDue(state.nextAt, this.lastPush.get(jid), this.now())) return;
    try {
      if (!state) {
        await this.initChannel(jid);
        return; // primeira rodada só marca o pts: sem backfill
      }
      await this.fetchDifference(jid, state);
    } catch (err) {
      const flood = floodSeconds(err);
      if (flood) {
        this.pausedUntil = this.now() + flood * 1_000;
        this.opts.logger.warn({ sessionId: this.opts.sessionId, seconds: flood }, 'Telegram channel catch-up paused by FLOOD_WAIT');
        return;
      }
      if (isChannelGone(err) || !state) this.skipped.add(jid);
      if (state) state.nextAt = nextPollAt(this.now(), undefined, this.baseMs);
      this.opts.logger.debug({ err, sessionId: this.opts.sessionId, jid }, 'Telegram channel catch-up failed for channel');
    }
  }

  private async initChannel(jid: string): Promise<void> {
    const input = await this.resolveInput(jid);
    const full = await this.opts.client.invoke(new Api.channels.GetFullChannel({ channel: input }));
    const fullChat = full.fullChat;
    if (!(fullChat instanceof Api.ChannelFull)) throw new Error('NOT_A_CHANNEL');
    const now = this.now();
    this.channels.set(jid, { input, pts: fullChat.pts, since: now, nextAt: nextPollAt(now, undefined, this.baseMs) });
  }

  private async resolveInput(jid: string): Promise<Api.InputChannel> {
    const tryResolve = async (): Promise<Api.InputChannel | null> => {
      try {
        const peer = await this.opts.client.getInputEntity(jid);
        return peer instanceof Api.InputPeerChannel
          ? new Api.InputChannel({ channelId: peer.channelId, accessHash: peer.accessHash })
          : null;
      } catch {
        return null;
      }
    };
    let input = await tryResolve();
    // Cache de entidades vazio após restart: uma listagem de dialogs por cliente o preenche
    if (!input && !this.dialogsLoaded) {
      this.dialogsLoaded = true;
      await this.opts.client.getDialogs({ limit: 500 });
      input = await tryResolve();
    }
    if (!input) throw new Error('CHANNEL_NOT_RESOLVED');
    return input;
  }

  private async fetchDifference(jid: string, state: ChannelState): Promise<void> {
    let timeout: number | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const diff = await this.opts.client.invoke(new Api.updates.GetChannelDifference({
        channel: state.input,
        filter: new Api.ChannelMessagesFilterEmpty(),
        pts: state.pts,
        limit: PAGE_LIMIT,
        force: false,
      }));
      timeout = diff.timeout;
      if (diff instanceof Api.updates.ChannelDifferenceEmpty) {
        state.pts = diff.pts;
        break;
      }
      if (diff instanceof Api.updates.ChannelDifferenceTooLong) {
        // Lacuna grande: recomeça do pts atual do dialog e entrega só o recente
        const dialog = diff.dialog;
        if (dialog instanceof Api.Dialog && dialog.pts) state.pts = dialog.pts;
        await this.emit(state, diff.messages, diff.users, diff.chats);
        break;
      }
      state.pts = diff.pts;
      await this.emit(state, diff.newMessages, diff.users, diff.chats);
      if (diff.final !== false) break;
    }
    state.nextAt = nextPollAt(this.now(), timeout, this.baseMs);
    this.opts.logger.debug({ sessionId: this.opts.sessionId, jid, pts: state.pts }, 'Telegram channel catch-up polled');
  }

  private async emit(state: ChannelState, messages: Api.TypeMessage[], users: Api.TypeUser[], chats: Api.TypeChat[]): Promise<void> {
    if (messages.length === 0) return;
    const entities = new Map<string, unknown>();
    for (const x of [...users, ...chats]) {
      try { entities.set(getPeerId(x), x); } catch { /* entidade sem id */ }
    }
    const sorted = messages
      .filter((m): m is Api.Message => m instanceof Api.Message && m.date * 1_000 >= state.since)
      .sort((a, b) => a.id - b.id);
    for (const msg of sorted) {
      if (this.stopped) return;
      (msg as unknown as { _finishInit(c: unknown, e: Map<string, unknown>, i: unknown): void })._finishInit(this.opts.client, entities, undefined);
      await this.opts.onMessage(msg);
    }
  }
}
