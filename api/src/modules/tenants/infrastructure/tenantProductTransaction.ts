import { PrismaAuditLogRepository } from '../../../shared/audit/PrismaAuditLogRepository';
import { UnitOfWork } from '../../../shared/database/UnitOfWork';
import type { TenantProductTransaction } from '../application/use-cases/SetTenantProductUseCase';
import { writeMergedSharedEntitlements, writePlanPresetWithoutSharedKeys } from './productEntitlements';
import { PrismaTenantProductRepository } from './repositories/PrismaTenantProductRepository';

/** Linha do produto, preset, merge das compartilhadas e AuditLog no mesmo `tx`: erro em qualquer um desfaz tudo. */
export const prismaTenantProductTransaction: TenantProductTransaction = (fn) =>
  new UnitOfWork().runInTransaction((tx) =>
    fn({
      tenantExists: async (tenantId) => (await tx.tenant.count({ where: { id: tenantId } })) > 0,
      products: new PrismaTenantProductRepository(tx),
      applyPlanPreset: async (tenantId, planSlug) => {
        await writePlanPresetWithoutSharedKeys(tx, tenantId, planSlug);
      },
      mergeSharedEntitlements: (tenantId) => writeMergedSharedEntitlements(tx, tenantId),
      audit: new PrismaAuditLogRepository(tx),
    }));
