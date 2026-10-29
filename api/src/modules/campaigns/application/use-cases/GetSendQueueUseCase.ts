import type { ISendQueueReader, SendQueueEntry } from '../../domain/contracts/ISendQueueReader';
import type { OfferDispatchStatus } from '../../domain/enums/OfferDispatchStatus';
import type { OfferOrigin } from '../../domain/enums/OfferOrigin';
import type { OfferStatus } from '../../domain/enums/OfferStatus';
import type { ISendingPauseStore } from '../../domain/contracts/ISendingPauseStore';
import { startOfDayInZone } from '../../domain/services/startOfDayInZone';

/** Envios abertos listados por sessão (os contadores são exatos, sem esse teto). */
export const SEND_QUEUE_OPEN_PER_SESSION = 100;
/** Concluídos de hoje listados por sessão. */
export const SEND_QUEUE_RECENT_PER_SESSION = 20;
/** Prévia do texto da oferta no item da fila. */
export const SEND_QUEUE_TEXT_PREVIEW = 160;

export interface SendQueueItemDTO {
  dispatchId: string;
  offerId: string;
  origin: OfferOrigin;
  offerStatus: OfferStatus;
  title: string | null;
  textPreview: string;
  imageUrl: string | null;
  coupon: string | null;
  conversationId: string;
  groupName: string | null;
  groupAvatarUrl: string | null;
  status: OfferDispatchStatus;
  notBefore: string;
  claimedAt: string | null;
  updatedAt: string;
  failureReason: string | null;
  /** Voltou para a fila porque a sessão estava fora do ar; sai quando ela reconectar. */
  waitingSession: boolean;
}

export interface SendQueueSessionDTO {
  /** null = envios antigos sem sessão registrada. */
  sessionId: string | null;
  name: string | null;
  status: string | null;
  running: SendQueueItemDTO | null;
  waiting: SendQueueItemDTO[];
  recent: SendQueueItemDTO[];
  counts: { waiting: number; paused: number; sentToday: number; failedToday: number; skippedToday: number };
}

export interface SendQueueDTO {
  serverTime: string;
  /** Pausa global de envios (ISO); null = ativos. */
  sendingPausedAt: string | null;
  sessions: SendQueueSessionDTO[];
}

export interface GetSendQueueInput {
  tenantId: string;
  sessionId?: string;
}

function toItem(e: SendQueueEntry): SendQueueItemDTO {
  return {
    dispatchId: e.dispatchId,
    offerId: e.offerId,
    origin: e.origin,
    offerStatus: e.offerStatus,
    title: e.title,
    // Por caractere (não unidade UTF-16): não corta emoji ao meio
    textPreview: [...e.text].length > SEND_QUEUE_TEXT_PREVIEW ? `${[...e.text].slice(0, SEND_QUEUE_TEXT_PREVIEW).join('')}…` : e.text,
    imageUrl: e.imageUrl,
    coupon: e.coupon,
    conversationId: e.conversationId,
    groupName: e.groupName,
    groupAvatarUrl: e.groupAvatarUrl,
    status: e.status,
    notBefore: e.notBefore.toISOString(),
    claimedAt: e.claimedAt?.toISOString() ?? null,
    updatedAt: e.updatedAt.toISOString(),
    failureReason: e.failureReason,
    waitingSession: e.waitingSession,
  };
}

/**
 * Fila de envio do tenant por sessão (faixa): o que está saindo, o que aguarda e o que já saiu
 * hoje. Fonte = banco; qualquer aba ou navegador vê o mesmo. Ver docs/fila-de-envio.md.
 */
export class GetSendQueueUseCase {
  constructor(private readonly deps: { reader: ISendQueueReader; pauses: ISendingPauseStore; now?: () => Date }) {}

  async execute(input: GetSendQueueInput): Promise<SendQueueDTO> {
    const now = (this.deps.now ?? (() => new Date()))();
    const pausedAt = await this.deps.pauses.get(input.tenantId);
    const snap = await this.deps.reader.read(input.tenantId, {
      sessionId: input.sessionId,
      since: startOfDayInZone(now),
      openLimitPerSession: SEND_QUEUE_OPEN_PER_SESSION,
      recentLimitPerSession: SEND_QUEUE_RECENT_PER_SESSION,
    });

    const groups = new Map<string | null, SendQueueSessionDTO>();
    const group = (sessionId: string | null): SendQueueSessionDTO => {
      let g = groups.get(sessionId);
      if (!g) {
        g = {
          sessionId, name: null, status: null, running: null, waiting: [], recent: [],
          counts: { waiting: 0, paused: 0, sentToday: 0, failedToday: 0, skippedToday: 0 },
        };
        groups.set(sessionId, g);
      }
      return g;
    };
    for (const s of snap.sessions) Object.assign(group(s.id), { name: s.name, status: s.status });

    for (const e of snap.open) {
      const g = group(e.sessionId);
      if (e.status === 'SENDING' && !g.running) g.running = toItem(e);
      else if (e.status === 'QUEUED') g.waiting.push(toItem(e));
    }
    for (const c of snap.openCounts) Object.assign(group(c.sessionId).counts, { waiting: c.waiting, paused: c.paused });
    for (const e of snap.recent) group(e.sessionId).recent.push(toItem(e));
    for (const c of snap.finishedToday) {
      const g = group(c.sessionId);
      if (c.status === 'SENT') g.counts.sentToday += c.count;
      else if (c.status === 'FAILED') g.counts.failedToday += c.count;
      else if (c.status === 'SKIPPED') g.counts.skippedToday += c.count;
    }

    // Sessões do tenant primeiro (ordem de criação); grupo sem sessão só se tiver algo
    const sessions = [...groups.values()].filter((g) => g.sessionId !== null || g.running || g.waiting.length || g.recent.length);
    return { serverTime: now.toISOString(), sendingPausedAt: pausedAt?.toISOString() ?? null, sessions };
  }
}
