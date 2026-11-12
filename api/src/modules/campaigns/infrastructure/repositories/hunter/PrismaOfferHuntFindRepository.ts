import type { PrismaClient } from '@prisma/client';
import type {
  IOfferHuntFindRepository,
  NewOfferHuntFind,
  OfferHuntFindTransition,
} from '../../../domain/contracts/hunter/IOfferHuntFindRepository';
import type { OfferHuntPageCursor } from '../../../domain/contracts/hunter/IOfferHuntRunRepository';
import type { OfferHuntFind, OfferHuntFindStatus } from '../../../domain/hunter/OfferHunt';
import { PrismaOfferHuntMapper as Mapper } from '../../mappers/PrismaOfferHuntMapper';

export class PrismaOfferHuntFindRepository implements IOfferHuntFindRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Desenho do `PrismaOfferRepository.createWithinDailyLimit`: `pg_advisory_xact_lock(hashtext(...))` por
   * tenant serializa as reservas até o fim da transação; recontagem + inserção de `min(N, saldo)`.
   */
  async insertWithinDailyLimit(tenantId: string, finds: NewOfferHuntFind[], quota: { since: Date; limit: number }): Promise<OfferHuntFind[]> {
    if (finds.length === 0) return [];
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`offer_hunt_finds:${tenantId}`}::text))`;
      const used = await tx.offerHuntFind.count({ where: { tenantId, createdAt: { gte: quota.since } } });
      const room = Math.max(0, quota.limit - used);
      const out = [];
      for (const f of finds.slice(0, room)) {
        out.push(await tx.offerHuntFind.create({
          data: { ...Mapper.snapshotToData(f), tenantId, huntId: f.huntId, runId: f.runId, status: f.status },
        }));
      }
      return out;
    });
    return rows.map(Mapper.findToDomain);
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
    const raw = await this.prisma.offerHuntFind.findFirst({ where: { id, tenantId } });
    return raw ? Mapper.findToDomain(raw) : null;
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
    });
    return rows.map(Mapper.findToDomain);
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
}
