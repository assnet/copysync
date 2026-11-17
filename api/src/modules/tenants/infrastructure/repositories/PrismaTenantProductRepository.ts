import type { PrismaClient } from '@prisma/client';
import type { TransactionClient } from '../../../../shared/database/UnitOfWork';
import type {
  ITenantProductRepository,
  TenantProduct,
  UpsertTenantProductInput,
} from '../../domain/contracts/ITenantProductRepository';
import type { ProductKey } from '../../domain/services/resolveProductAccess';
import { PrismaTenantProductMapper } from '../mappers/PrismaTenantProductMapper';

type Db = Pick<PrismaClient | TransactionClient, 'tenantProduct'>;

export class PrismaTenantProductRepository implements ITenantProductRepository {
  constructor(private readonly db: Db) {}

  async find(tenantId: string, product: ProductKey): Promise<TenantProduct | null> {
    const row = await this.db.tenantProduct.findUnique({ where: { tenantId_product: { tenantId, product } } });
    return row ? PrismaTenantProductMapper.toDomain(row) : null;
  }

  async findAll(tenantId: string): Promise<TenantProduct[]> {
    const rows = await this.db.tenantProduct.findMany({ where: { tenantId }, orderBy: { product: 'asc' } });
    return rows.map(PrismaTenantProductMapper.toDomain).filter((r): r is TenantProduct => r !== null);
  }

  async upsert(input: UpsertTenantProductInput): Promise<TenantProduct> {
    const { tenantId, product, status, planSlug, expiresAt, source } = input;
    const now = new Date();
    // Upsert do Prisma vira INSERT ... ON CONFLICT no Postgres (chave única tenant+produto): sem duplicata.
    const row = await this.db.tenantProduct.upsert({
      where: { tenantId_product: { tenantId, product } },
      create: { tenantId, product, status, planSlug, expiresAt, source, inactiveSince: status === 'ACTIVE' ? null : now },
      update: { status, planSlug, expiresAt, source, ...(status === 'ACTIVE' ? { inactiveSince: null } : {}) },
    });
    // Virou INACTIVE agora: marca o início (mantém a data se já estava inativa).
    if (status === 'INACTIVE' && row.inactiveSince === null) {
      const marked = await this.db.tenantProduct.update({
        where: { tenantId_product: { tenantId, product } },
        data: { inactiveSince: now },
      });
      return this.mapOrThrow(marked);
    }
    return this.mapOrThrow(row);
  }

  private mapOrThrow(row: Parameters<typeof PrismaTenantProductMapper.toDomain>[0]): TenantProduct {
    const mapped = PrismaTenantProductMapper.toDomain(row);
    if (!mapped) throw new Error(`Unknown product in tenant_products: ${row.product}`);
    return mapped;
  }
}
