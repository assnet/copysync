import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  CreatePremiumSlugGrantInput,
  IPremiumSlugGrantRepository,
} from '../../domain/contracts/IPremiumSlugGrantRepository';
import type { PremiumSlugGrant } from '../../domain/entities/PremiumSlugGrant';
import { LinkSlugTakenError } from '../../../../shared/errors/internal/LinkRotationErrors';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { PrismaPremiumSlugGrantMapper } from '../mappers/PrismaPremiumSlugGrantMapper';

const knownCode = (err: unknown): string | null =>
  err instanceof Prisma.PrismaClientKnownRequestError ? err.code : null;

/** Liberações de nome premium. Só super-admin (rotas `/admin/link-domains/:id/premium-grants`). */
export class PrismaPremiumSlugGrantRepository implements IPremiumSlugGrantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listByDomain(domainId: string): Promise<PremiumSlugGrant[]> {
    const rows = await this.prisma.premiumSlugGrant.findMany({ where: { domainId }, orderBy: { slug: 'asc' } });
    return rows.map(PrismaPremiumSlugGrantMapper.toDomain);
  }

  async findById(domainId: string, id: string): Promise<PremiumSlugGrant | null> {
    const row = await this.prisma.premiumSlugGrant.findFirst({ where: { id, domainId } });
    return row ? PrismaPremiumSlugGrantMapper.toDomain(row) : null;
  }

  async create(input: CreatePremiumSlugGrantInput): Promise<PremiumSlugGrant> {
    try {
      const row = await this.prisma.premiumSlugGrant.create({ data: { ...input } });
      return PrismaPremiumSlugGrantMapper.toDomain(row);
    } catch (err) {
      const code = knownCode(err);
      if (code === 'P2002') throw new LinkSlugTakenError([]);
      if (code === 'P2003') throw new NotFoundError('Tenant', input.tenantId);
      throw err;
    }
  }

  async delete(domainId: string, id: string): Promise<void> {
    const { count } = await this.prisma.premiumSlugGrant.deleteMany({ where: { id, domainId } });
    if (count === 0) throw new NotFoundError('PremiumSlugGrant', id);
  }
}
