import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  IOfferHuntFindRepository,
  NewOfferHuntFind,
  OfferHuntFindTransition,
} from '../../../domain/contracts/hunter/IOfferHuntFindRepository';
import type { OfferHuntPageCursor } from '../../../domain/contracts/hunter/IOfferHuntRunRepository';
import type { OfferHuntFind, OfferHuntFindDelivery, OfferHuntFindStatus } from '../../../domain/hunter/OfferHunt';
import { PrismaOfferHuntMapper as Mapper } from '../../mappers/PrismaOfferHuntMapper';

/** Disparo mais recente da oferta atual + nome do grupo (tenant em todo filtro). */
const deliveryInclude = (tenantId: string) => ({
  offer: {
    select: {
      tenantId: true,
      dispatches: {
        where: { tenantId },
        orderBy: { updatedAt: 'desc' as const },
        take: 1,
        select: { status: true, updatedAt: true, sessionId: true, conversation: { select: { tenantId: true, groupName: true } } },
      },
    },
  },
});
type FindWithDelivery = Prisma.OfferHuntFindGetPayload<{ include: ReturnType<typeof deliveryInclude> }>;

export class PrismaOfferHuntFindRepository implements IOfferHuntFindRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Achados + envio real (status do disparo, grupo e sessão). Nome da sessão numa consulta só, do tenant. */
  private async withDelivery(tenantId: string, rows: FindWithDelivery[]): Promise<OfferHuntFind[]> {
    const sessionIds = [...new Set(rows.flatMap((r) => {
      const d = r.offer?.tenantId === tenantId ? r.offer.dispatches[0] : undefined;
      return d?.sessionId ? [d.sessionId] : [];
    }))];
    const sessions = sessionIds.length === 0 ? [] : await this.prisma.session.findMany({
      where: { tenantId, id: { in: sessionIds } }, select: { id: true, name: true },
    });
    const sessionName = new Map(sessions.map((s) => [s.id, s.name]));
    return rows.map((r) => {
      const { offer, ...raw } = r;
      const find = Mapper.findToDomain(raw);
      const d = offer?.tenantId === tenantId ? offer.dispatches[0] : undefined;
      if (!d) return find;
      const delivery: OfferHuntFindDelivery = {
        dispatchStatus: d.status,
        sentAt: d.status === 'SENT' ? d.updatedAt : null,
        groupName: d.conversation.tenantId === tenantId ? d.conversation.groupName : null,
        sessionName: d.sessionId ? (sessionName.get(d.sessionId) ?? null) : null,
      };
      return { ...find, delivery };
    });
  }

  /**
   * Desenho do `PrismaOfferRepository.createWithinDailyLimit`: `pg_advisory_xact_lock(hashtext(...))` por
   * tenant serializa as reservas até o fim da transação; recontagem + inserção de `min(N, saldo)`.
   */
  async insertWithinDailyLimit(
    tenantId: string, finds: NewOfferHuntFind[], quota: { since: Date; limit: number; repeatSince?: Date },
  ): Promise<OfferHuntFind[]> {
    if (finds.length === 0) return [];
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`offer_hunt_finds:${tenantId}`}::text))`;
      const fresh = await this.withoutRepeats(tx, tenantId, finds, quota.repeatSince);
      const used = await tx.offerHuntFind.count({ where: { tenantId, createdAt: { gte: quota.since } } });
      const room = Math.max(0, quota.limit - used);
      const out = [];
      for (const f of fresh.slice(0, room)) {
        out.push(await tx.offerHuntFind.create({
          data: { ...Mapper.snapshotToData(f), tenantId, huntId: f.huntId, runId: f.runId, status: f.status },
        }));
      }
      return out;
    });
    return rows.map(Mapper.findToDomain);
  }

  /**
   * Anti-join da repetição dentro do lock: duas execuções simultâneas da mesma caçada (MANUAL × AUTO)
   * leem `recentGoodsIds` antes de qualquer gravação; aqui a 2ª vê o que a 1ª gravou e descarta.
   */
  private async withoutRepeats(
    tx: Prisma.TransactionClient, tenantId: string, finds: NewOfferHuntFind[], repeatSince: Date | undefined,
  ): Promise<NewOfferHuntFind[]> {
    if (!repeatSince) return finds;
    const huntIds = [...new Set(finds.flatMap((f) => (f.huntId ? [f.huntId] : [])))];
    const taken = new Set<string>();
    if (huntIds.length > 0) {
      const rows = await tx.offerHuntFind.findMany({
        where: { tenantId, huntId: { in: huntIds }, createdAt: { gte: repeatSince } },
        select: { huntId: true, goodsId: true },
      });
      for (const r of rows) taken.add(`${r.huntId}:${r.goodsId}`);
    }
    return finds.filter((f) => {
      if (!f.huntId) return true;
      const key = `${f.huntId}:${f.goodsId}`;
      if (taken.has(key)) return false;
      taken.add(key);
      return true;
    });
  }

  countCreatedSince(tenantId: string, since: Date): Promise<number> {
    return this.prisma.offerHuntFind.count({ where: { tenantId, createdAt: { gte: since } } });
  }

  async recentGoodsIds(tenantId: string, huntId: string, since: Date): Promise<Set<string>> {
    const rows = await this.prisma.offerHuntFind.findMany({
      where: { tenantId, huntId, createdAt: { gte: since } },
      select: { goodsId: true },
      distinct: ['goodsId'],
    });
    return new Set(rows.map((r) => r.goodsId));
  }

  async findById(tenantId: string, id: string): Promise<OfferHuntFind | null> {
    const raw = await this.prisma.offerHuntFind.findFirst({ where: { id, tenantId }, include: deliveryInclude(tenantId) });
    return raw ? (await this.withDelivery(tenantId, [raw]))[0]! : null;
  }

  async listByHunt(tenantId: string, huntId: string, page: { limit: number; after?: OfferHuntPageCursor }): Promise<OfferHuntFind[]> {
    const after = page.after;
    const rows = await this.prisma.offerHuntFind.findMany({
      where: {
        tenantId, huntId,
        ...(after ? { OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit,
      include: deliveryInclude(tenantId),
    });
    return this.withDelivery(tenantId, rows);
  }

  async transition(
    tenantId: string, id: string, from: OfferHuntFindStatus[], to: OfferHuntFindStatus, extra: OfferHuntFindTransition = {},
  ): Promise<boolean> {
    if (from.length === 0) return false;
    const { count } = await this.prisma.offerHuntFind.updateMany({
      where: { id, tenantId, status: { in: from } },
      data: {
        status: to,
        ...(extra.offerId !== undefined ? { offerId: extra.offerId } : {}),
        ...(extra.failureReason !== undefined ? { failureReason: extra.failureReason } : {}),
      },
    });
    return count > 0;
  }

  async claimResend(tenantId: string, id: string, offerId: string, now: Date, cooldownMs: number): Promise<boolean> {
    const { count } = await this.prisma.offerHuntFind.updateMany({
      where: {
        id, tenantId, offerId,
        OR: [{ lastResentAt: null }, { lastResentAt: { lt: new Date(now.getTime() - cooldownMs) } }],
      },
      data: { lastResentAt: now },
    });
    return count > 0;
  }

  async recordResend(tenantId: string, id: string, offerId: string): Promise<void> {
    await this.prisma.offerHuntFind.updateMany({
      where: { id, tenantId },
      data: { offerId, status: 'SENT', failureReason: null, resendCount: { increment: 1 } },
    });
  }

  async reclaimStaleApproved(tenantId: string, id: string, before: Date): Promise<boolean> {
    const { count } = await this.prisma.offerHuntFind.updateMany({
      where: { id, tenantId, status: 'APPROVED', offerId: null, updatedAt: { lt: before } },
      data: { updatedAt: new Date() },
    });
    return count > 0;
  }
}
