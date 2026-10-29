import type { PrismaClient } from '@prisma/client';
import type { TransactionClient } from '../../../../shared/database/UnitOfWork';
import type {
  CreateStorefrontInput,
  IStorefrontRepository,
  PublicStorefront,
  UpdateStorefrontInput,
} from '../../domain/contracts/IStorefrontRepository';
import type { Storefront } from '../../domain/entities/Storefront';
import type { StorefrontStatus } from '../../domain/enums/StorefrontEnums';
import { StorefrontNotFoundError } from '../../../../shared/errors/internal/StorefrontErrors';
import { PrismaStorefrontMapper } from '../mappers/PrismaStorefrontMapper';

/** Endereço da página: sempre do claim, nunca de coluna da página. */
const WITH_CLAIM = { claim: { select: { domainId: true, slug: true } } } as const;

/**
 * Página do tenant (1 por tenant). Tudo filtra `tenantId`, exceto `findPublicByAddress` (rota pública).
 * Aceita o client normal ou um `TransactionClient` (ex.: efeitos de plano dentro da tx do billing):
 * com tx, as etapas rodam direto nele (tx client não tem `$transaction` para aninhar).
 */
export class PrismaStorefrontRepository implements IStorefrontRepository {
  constructor(private readonly prisma: PrismaClient | TransactionClient) {}

  private atomic<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    const db = this.prisma;
    return '$transaction' in db ? db.$transaction(fn) : fn(db);
  }

  async findByTenant(tenantId: string): Promise<Storefront | null> {
    const row = await this.prisma.storefront.findUnique({ where: { tenantId }, include: WITH_CLAIM });
    return row ? PrismaStorefrontMapper.toDomain(row) : null;
  }

  async create(input: CreateStorefrontInput): Promise<Storefront> {
    const row = await this.prisma.storefront.create({
      data: {
        tenantId: input.tenantId,
        title: input.title,
        subtitle: input.subtitle,
        colorPrimary: input.colorPrimary,
        colorBackground: input.colorBackground,
        colorCard: input.colorCard,
        categories: [...input.categories],
      },
      include: WITH_CLAIM,
    });
    return PrismaStorefrontMapper.toDomain(row);
  }

  async update(tenantId: string, input: UpdateStorefrontInput): Promise<Storefront> {
    const row = await this.atomic(async (tx) => {
      const { count } = await tx.storefront.updateMany({
        where: { tenantId },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.subtitle !== undefined && { subtitle: input.subtitle }),
          ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
          ...(input.coverUrl !== undefined && { coverUrl: input.coverUrl }),
          ...(input.colorPrimary !== undefined && { colorPrimary: input.colorPrimary }),
          ...(input.colorBackground !== undefined && { colorBackground: input.colorBackground }),
          ...(input.colorCard !== undefined && { colorCard: input.colorCard }),
          ...(input.categories !== undefined && { categories: [...input.categories] }),
        },
      });
      if (count === 0) return null;
      return tx.storefront.findUnique({ where: { tenantId }, include: WITH_CLAIM });
    });
    if (!row) throw new StorefrontNotFoundError();
    return PrismaStorefrontMapper.toDomain(row);
  }

  async setStatus(tenantId: string, status: StorefrontStatus): Promise<StorefrontStatus | null> {
    const { count } = await this.prisma.storefront.updateMany({ where: { tenantId }, data: { status } });
    return count === 0 ? null : status;
  }

  /** Claim e ofertas caem por cascade (libera o endereço). */
  async delete(tenantId: string): Promise<void> {
    await this.prisma.storefront.deleteMany({ where: { tenantId } });
  }

  /**
   * ÚNICA consulta sem tenantId: a rota pública não tem sessão, quem decide é o Host
   * (`domainId` já resolvido + slug, unique no claim). Só claim de kind STOREFRONT.
   * `tenantActive` = Tenant.status === 'ACTIVE' (SUSPENDED/CANCELLED → página indisponível).
   */
  async findPublicByAddress(domainId: string, slug: string): Promise<PublicStorefront | null> {
    const claim = await this.prisma.publicSlugClaim.findUnique({
      where: { domainId_slug: { domainId, slug: slug.trim().toLowerCase() } },
      select: {
        kind: true,
        storefront: { include: { ...WITH_CLAIM, tenant: { select: { status: true } } } },
      },
    });
    if (!claim || claim.kind !== 'STOREFRONT' || !claim.storefront) return null;
    const { tenant, ...storefront } = claim.storefront;
    return { storefront: PrismaStorefrontMapper.toDomain(storefront), tenantActive: tenant.status === 'ACTIVE' };
  }
}
