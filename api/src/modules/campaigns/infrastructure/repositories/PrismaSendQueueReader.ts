import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  ISendQueueReader,
  SendQueueEntry,
  SendQueueReadOptions,
  SendQueueSnapshot,
} from '../../domain/contracts/ISendQueueReader';

const FINISHED = ['SENT', 'FAILED', 'SKIPPED', 'CANCELLED'] as const;

const entrySelect = {
  id: true,
  offerId: true,
  sessionId: true,
  conversationId: true,
  status: true,
  notBefore: true,
  claimedAt: true,
  updatedAt: true,
  failureReason: true,
  offer: { select: { origin: true, status: true, title: true, text: true, imageUrl: true, coupon: true } },
  conversation: { select: { groupName: true, groupAvatarUrl: true } },
} satisfies Prisma.OfferDispatchSelect;

type EntryRow = Prisma.OfferDispatchGetPayload<{ select: typeof entrySelect }>;

function toEntry(r: EntryRow): SendQueueEntry {
  return {
    dispatchId: r.id,
    offerId: r.offerId,
    origin: r.offer.origin,
    offerStatus: r.offer.status,
    title: r.offer.title,
    text: r.offer.text,
    imageUrl: r.offer.imageUrl,
    coupon: r.offer.coupon,
    sessionId: r.sessionId,
    conversationId: r.conversationId,
    groupName: r.conversation.groupName,
    groupAvatarUrl: r.conversation.groupAvatarUrl,
    status: r.status,
    notBefore: r.notBefore,
    claimedAt: r.claimedAt,
    updatedAt: r.updatedAt,
    failureReason: r.failureReason,
  };
}

export class PrismaSendQueueReader implements ISendQueueReader {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Listas lidas por sessão (uma sessão com muita fila não esconde as outras); contadores por
   * `groupBy`, exatos. Sessões por tenant são poucas (limite do plano), então N consultas pequenas.
   */
  async read(tenantId: string, o: SendQueueReadOptions): Promise<SendQueueSnapshot> {
    const sessions = await this.prisma.session.findMany({
      where: { tenantId, deletedAt: null, ...(o.sessionId ? { id: o.sessionId } : {}) },
      select: { id: true, name: true, status: true },
      orderBy: { createdAt: 'asc' },
    });
    // Sem filtro, inclui a faixa "sem sessão" (envios anteriores à fila) e sessões apagadas com fila
    const lanes: (string | null)[] = o.sessionId ? [o.sessionId] : [...sessions.map((s) => s.id), null];
    const bySession = o.sessionId ? { sessionId: o.sessionId } : {};
    const openWhere = (sessionId: string | null): Prisma.OfferDispatchWhereInput => ({
      tenantId, sessionId, status: { in: ['QUEUED', 'SENDING'] }, offer: { status: { in: ['SENDING', 'PAUSED'] } },
    });
    const recentWhere = (sessionId: string | null): Prisma.OfferDispatchWhereInput => ({
      tenantId, sessionId, status: { in: [...FINISHED] }, updatedAt: { gte: o.since },
    });

    const [open, recent, waiting, paused, finished] = await Promise.all([
      Promise.all(lanes.map((sid) => this.prisma.offerDispatch.findMany({
        where: openWhere(sid), select: entrySelect, orderBy: { notBefore: 'asc' }, take: o.openLimitPerSession,
      }))),
      Promise.all(lanes.map((sid) => this.prisma.offerDispatch.findMany({
        where: recentWhere(sid), select: entrySelect, orderBy: { updatedAt: 'desc' }, take: o.recentLimitPerSession,
      }))),
      this.prisma.offerDispatch.groupBy({
        by: ['sessionId'], where: { tenantId, ...bySession, status: 'QUEUED', offer: { status: 'SENDING' } }, _count: { _all: true },
      }),
      this.prisma.offerDispatch.groupBy({
        by: ['sessionId'], where: { tenantId, ...bySession, status: 'QUEUED', offer: { status: 'PAUSED' } }, _count: { _all: true },
      }),
      this.prisma.offerDispatch.groupBy({
        by: ['sessionId', 'status'],
        where: { tenantId, ...bySession, status: { in: [...FINISHED] }, updatedAt: { gte: o.since } },
        _count: { _all: true },
      }),
    ]);

    const counts = new Map<string | null, { waiting: number; paused: number }>();
    const slot = (sid: string | null) => counts.get(sid) ?? counts.set(sid, { waiting: 0, paused: 0 }).get(sid)!;
    for (const g of waiting) slot(g.sessionId).waiting = g._count._all;
    for (const g of paused) slot(g.sessionId).paused = g._count._all;

    return {
      sessions,
      open: open.flat().map(toEntry),
      recent: recent.flat().map(toEntry),
      openCounts: [...counts].map(([sessionId, c]) => ({ sessionId, ...c })),
      finishedToday: finished.map((c) => ({ sessionId: c.sessionId, status: c.status, count: c._count._all })),
    };
  }
}
