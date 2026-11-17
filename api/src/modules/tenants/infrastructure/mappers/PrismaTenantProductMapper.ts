import type { TenantProduct as PrismaTenantProduct } from '@prisma/client';
import type { TenantProduct, TenantProductSource } from '../../domain/contracts/ITenantProductRepository';
import { isProductKey, type TenantProductStatus } from '../../domain/services/resolveProductAccess';

/** Prisma → domínio. Linha com produto desconhecido (gravado por versão futura) é ignorada: `null`. */
export class PrismaTenantProductMapper {
  static toDomain(row: PrismaTenantProduct): TenantProduct | null {
    if (!isProductKey(row.product)) return null;
    return {
      tenantId: row.tenantId,
      product: row.product,
      // Qualquer valor diferente de ACTIVE nega: linha corrompida nunca libera produto.
      status: (row.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE') satisfies TenantProductStatus,
      planSlug: row.planSlug,
      expiresAt: row.expiresAt,
      source: (row.source === 'ADMIN' ? 'ADMIN' : 'BILLING') satisfies TenantProductSource,
      inactiveSince: row.inactiveSince,
      updatedAt: row.updatedAt,
    };
  }
}
