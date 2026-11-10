import { PrismaAuditLogRepository } from '../../../shared/audit/PrismaAuditLogRepository';
import { UnitOfWork } from '../../../shared/database/UnitOfWork';
import type { IPlanEntitlementPresetRepository } from '../domain/contracts/IPlanEntitlementPresetRepository';
import type { PlanEntitlementTransaction } from '../application/use-cases/SetPlanEntitlementUseCase';
import { PrismaPlanEntitlementPresetRepository } from './repositories/PrismaPlanEntitlementPresetRepository';

/** Preset, tenants do plano e AuditLog no mesmo `tx`: erro em qualquer um desfaz tudo. */
export const prismaPlanEntitlementTransaction: PlanEntitlementTransaction = (fn) =>
  new UnitOfWork().runInTransaction((tx) =>
    fn({ presets: new PrismaPlanEntitlementPresetRepository(tx), audit: new PrismaAuditLogRepository(tx) }));

/** Repositório fora de transação (leitura do admin). Rotas não importam `prisma`. */
export const createPlanEntitlementPresetRepository = (): IPlanEntitlementPresetRepository =>
  new PrismaPlanEntitlementPresetRepository();
