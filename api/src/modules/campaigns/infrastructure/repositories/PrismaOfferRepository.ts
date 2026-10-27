import type { PrismaClient } from '@prisma/client';
import type {
  CreateOfferInput,
  DailyQuota,
  IOfferRepository,
  OfferPatch,
  UpdateOfferResult,
} from '../../domain/contracts/IOfferRepository';
import { EDITABLE_OFFER_STATUSES } from '../../domain/contracts/IOfferRepository';
import type { Offer } from '../../domain/entities/Offer';
import type { OfferStatus } from '../../domain/enums/OfferStatus';
import { PrismaOfferMapper as Mapper } from '../mappers/PrismaOfferMapper';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';

export class PrismaOfferRepository implements IOfferRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateOfferInput): Promise<Offer> {
    const raw = await this.prisma.offer.create({ data: { ...input, status: 'DRAFT' } });
    return Mapper.toDomain(raw);
  }

  /**
   * `pg_advisory_xact_lock(hashtext(tenantId))` serializa gerações concorrentes do tenant até o
   * fim da transação: duas requisições não passam juntas pela recontagem.
   */
  async createWithinDailyLimit(input: CreateOfferInput, quota: DailyQuota): Promise<Offer> {
    const raw = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.tenantId}::text))`;
      const used = await tx.offer.count({ where: { tenantId: input.tenantId, createdAt: { gte: quota.since } } });
      if (used >= quota.limit) throw new PlanLimitReachedError(quota.key, quota.limit);
      return tx.offer.create({ data: { ...input, status: 'DRAFT' } });
    });
    return Mapper.toDomain(raw);
  }

  async findBySourceKey(tenantId: string, sourceKey: string): Promise<Offer | null> {
    const raw = await this.prisma.offer.findFirst({ where: { tenantId, sourceKey } });
    return raw ? Mapper.toDomain(raw) : null;
  }

  async findById(id: string, tenantId: string): Promise<Offer | null> {
    const raw = await this.prisma.offer.findFirst({ where: { id, tenantId } });
    return raw ? Mapper.toDomain(raw) : null;
  }

  /** updateMany condicional evita corrida com o início do envio (e com outra edição, via `updatedAt`); refetch para devolver a linha. */
  async update(id: string, tenantId: string, patch: OfferPatch, expectedUpdatedAt?: Date): Promise<UpdateOfferResult> {
    const { count } = await this.prisma.offer.updateMany({
      where: {
        id,
        tenantId,
        status: { in: [...EDITABLE_OFFER_STATUSES] },
        ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}),
      },
      data: patch,
    });
    const current = await this.findById(id, tenantId);
    if (!current) return { outcome: 'not_found' };
    if (count === 0) {
      return EDITABLE_OFFER_STATUSES.includes(current.status) && expectedUpdatedAt
        ? { outcome: 'changed' }
        : { outcome: 'not_editable' };
    }
    return { outcome: 'updated', offer: current };
  }

  async countCreatedSince(tenantId: string, since: Date): Promise<number> {
    return this.prisma.offer.count({ where: { tenantId, createdAt: { gte: since } } });
  }

  async transitionStatus(id: string, tenantId: string, from: OfferStatus[], to: OfferStatus): Promise<boolean> {
    if (from.length === 0) return false;
    const { count } = await this.prisma.offer.updateMany({
      where: { id, tenantId, status: { in: from } },
      data: { status: to },
    });
    return count > 0;
  }
}
