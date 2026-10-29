import type { PrismaClient } from '@prisma/client';
import type { TransactionClient } from '../../../../shared/database/UnitOfWork';
import type {
  CreateStorefrontOfferInput,
  IStorefrontOfferRepository,
  SetStorefrontOfferStatusInput,
  StorefrontOfferCounts,
  UpdateStorefrontOfferInput,
} from '../../domain/contracts/IStorefrontOfferRepository';
import type { StorefrontOffer } from '../../domain/entities/StorefrontOffer';
import { StorefrontOfferStatus } from '../../domain/enums/StorefrontEnums';
import { StorefrontNotFoundError } from '../../../../shared/errors/internal/StorefrontErrors';
import { PrismaStorefrontOfferMapper } from '../mappers/PrismaStorefrontOfferMapper';

/** Enum Postgres ordena pela declaração: DRAFT antes de PUBLISHED. */
const TAB_ORDER = [{ status: 'asc' }, { position: 'asc' }] as const;

/**
 * Ofertas da página. Todo where leva `tenantId`. Aceita client normal ou `TransactionClient`:
 * com tx, `setPositions` roda direto nele (sem aninhar `$transaction`).
 */
export class PrismaStorefrontOfferRepository implements IStorefrontOfferRepository {
  constructor(private readonly prisma: PrismaClient | TransactionClient) {}

  private atomic<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    const db = this.prisma;
    return '$transaction' in db ? db.$transaction(fn) : fn(db);
  }

  async listByStorefront(tenantId: string, storefrontId: string): Promise<StorefrontOffer[]> {
    const rows = await this.prisma.storefrontOffer.findMany({ where: { tenantId, storefrontId }, orderBy: [...TAB_ORDER] });
    return rows.map(PrismaStorefrontOfferMapper.toDomain);
  }

  async listPublished(tenantId: string, storefrontId: string): Promise<StorefrontOffer[]> {
    const rows = await this.prisma.storefrontOffer.findMany({
      where: { tenantId, storefrontId, status: StorefrontOfferStatus.PUBLISHED },
      orderBy: { position: 'asc' },
    });
    return rows.map(PrismaStorefrontOfferMapper.toDomain);
  }

  async findById(tenantId: string, id: string): Promise<StorefrontOffer | null> {
    const row = await this.prisma.storefrontOffer.findFirst({ where: { id, tenantId } });
    return row ? PrismaStorefrontOfferMapper.toDomain(row) : null;
  }

  /** Um GROUP BY status: total = soma das abas. */
  async countByStorefront(tenantId: string, storefrontId: string): Promise<StorefrontOfferCounts> {
    const groups = await this.prisma.storefrontOffer.groupBy({
      by: ['status'],
      where: { tenantId, storefrontId },
      _count: { _all: true },
    });
    let total = 0;
    let published = 0;
    for (const g of groups) {
      total += g._count._all;
      if (g.status === StorefrontOfferStatus.PUBLISHED) published = g._count._all;
    }
    return { total, published };
  }

  async maxPosition(tenantId: string, storefrontId: string, status: StorefrontOfferStatus): Promise<number | null> {
    const agg = await this.prisma.storefrontOffer.aggregate({
      where: { tenantId, storefrontId, status },
      _max: { position: true },
    });
    return agg._max.position;
  }

  async listIdsByStatus(tenantId: string, storefrontId: string, status: StorefrontOfferStatus): Promise<string[]> {
    const rows = await this.prisma.storefrontOffer.findMany({
      where: { tenantId, storefrontId, status },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async create(input: CreateStorefrontOfferInput): Promise<StorefrontOffer> {
    const row = await this.prisma.storefrontOffer.create({
      data: {
        tenantId: input.tenantId,
        storefrontId: input.storefrontId,
        status: input.status,
        position: input.position,
        provider: input.provider,
        sourceUrl: input.sourceUrl,
        affiliateUrl: input.affiliateUrl,
        attributionVerified: input.attributionVerified,
        title: input.title,
        priceCents: input.priceCents,
        originalPriceCents: input.originalPriceCents,
        imageUrl: input.imageUrl,
        category: input.category,
      },
    });
    return PrismaStorefrontOfferMapper.toDomain(row);
  }

  async update(tenantId: string, id: string, input: UpdateStorefrontOfferInput): Promise<StorefrontOffer> {
    return this.updateOne(tenantId, id, {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.priceCents !== undefined && { priceCents: input.priceCents }),
      ...(input.originalPriceCents !== undefined && { originalPriceCents: input.originalPriceCents }),
      ...(input.category !== undefined && { category: input.category }),
    });
  }

  async setStatus(tenantId: string, id: string, input: SetStorefrontOfferStatusInput): Promise<StorefrontOffer> {
    return this.updateOne(tenantId, id, { status: input.status, position: input.position, publishedAt: input.publishedAt });
  }

  /** Ids já validados pelo use case; o where com tenant/página impede tocar oferta alheia. */
  async setPositions(tenantId: string, storefrontId: string, orderedIds: readonly string[]): Promise<void> {
    if (orderedIds.length === 0) return;
    await this.atomic(async (tx) => {
      for (const [position, id] of orderedIds.entries()) {
        await tx.storefrontOffer.updateMany({ where: { id, tenantId, storefrontId }, data: { position } });
      }
    });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const { count } = await this.prisma.storefrontOffer.deleteMany({ where: { id, tenantId } });
    if (count === 0) throw new StorefrontNotFoundError(id);
  }

  /** `not: null` explícito: `notIn: []` sozinho casaria também as já sem categoria. */
  async clearCategoriesNotIn(tenantId: string, storefrontId: string, keep: readonly string[]): Promise<number> {
    const { count } = await this.prisma.storefrontOffer.updateMany({
      where: { tenantId, storefrontId, category: { not: null, notIn: [...keep] } },
      data: { category: null },
    });
    return count;
  }

  private async updateOne(
    tenantId: string,
    id: string,
    data: Parameters<TransactionClient['storefrontOffer']['updateMany']>[0]['data'],
  ): Promise<StorefrontOffer> {
    const row = await this.atomic(async (tx) => {
      const { count } = await tx.storefrontOffer.updateMany({ where: { id, tenantId }, data });
      return count === 0 ? null : tx.storefrontOffer.findFirst({ where: { id, tenantId } });
    });
    if (!row) throw new StorefrontNotFoundError(id);
    return PrismaStorefrontOfferMapper.toDomain(row);
  }
}
