import type { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma.client';
import type { TransactionClient } from '../../../../shared/database/UnitOfWork';
import { entitlementJsonValue } from '../../../integrations/billing/entitlementJsonValue';
import type { PlanPresetValue } from '../../domain/planPresets';
import { productOfPlanSlug } from '../../domain/planCatalog';
import { SHARED_KEYS } from '../../domain/sharedEntitlements';
import { writeMergedSharedEntitlements } from '../productEntitlements';
import type {
  IPlanEntitlementPresetRepository,
  PlanEntitlementPresetRow,
  SetPlanEntitlementInput,
} from '../../domain/contracts/IPlanEntitlementPresetRepository';

function toPresetValue(raw: Prisma.JsonValue | null): PlanPresetValue {
  return typeof raw === 'boolean' || typeof raw === 'number' ? raw : null;
}

/**
 * Sem `db`, `setForPlan` abre a própria transação; com `db` de transação (UnitOfWork), roda nela
 * (ex.: auditoria do admin no mesmo commit).
 */
export class PrismaPlanEntitlementPresetRepository implements IPlanEntitlementPresetRepository {
  private readonly db: TransactionClient | undefined;
  constructor(db?: TransactionClient) { this.db = db; }

  async listByKeys(keys: readonly string[]): Promise<PlanEntitlementPresetRow[]> {
    if (keys.length === 0) return [];
    const rows = await (this.db ?? prisma).planEntitlementPreset.findMany({
      where: { key: { in: [...keys] } },
      orderBy: [{ key: 'asc' }, { planSlug: 'asc' }],
    });
    return rows.map((r) => ({ planSlug: r.planSlug, key: r.key, value: toPresetValue(r.value) }));
  }

  async setForPlan(input: SetPlanEntitlementInput): Promise<{ tenantsUpdated: number }> {
    if (this.db) return this.write(this.db, input);
    return prisma.$transaction((tx) => this.write(tx, input));
  }

  private async write(tx: TransactionClient, input: SetPlanEntitlementInput): Promise<{ tenantsUpdated: number }> {
    const { planSlug, key, value } = input;
    const json = entitlementJsonValue(value);
    await tx.planEntitlementPreset.upsert({
      where: { planSlug_key: { planSlug, key } },
      create: { planSlug, key, value: json },
      update: { value: json },
    });
    if (productOfPlanSlug(planSlug) !== 'AFFILIATES') return this.propagateToProductTenants(tx, input);
    const tenants = await tx.tenant.findMany({ where: { planSlug }, select: { id: true } });
    const tenantIds = tenants.map((t) => t.id);
    if (tenantIds.length === 0) return { tenantsUpdated: 0 };
    // upsert em lote: atualiza quem já tem a chave e cria para os demais
    await tx.tenantEntitlement.updateMany({ where: { key, tenantId: { in: tenantIds } }, data: { value: json } });
    await tx.tenantEntitlement.createMany({
      data: tenantIds.map((tenantId) => ({ tenantId, key, value: json })),
      skipDuplicates: true,
    });
    return { tenantsUpdated: tenantIds.length };
  }

  /**
   * Plano de produto novo: `Tenant.planSlug` é o de Afiliados, então os tenants saem de `tenant_products`
   * (linha ativa com o plano). Chave compartilhada nunca é gravada direto: o merge entre produtos decide.
   */
  private async propagateToProductTenants(tx: TransactionClient, { planSlug, key, value }: SetPlanEntitlementInput): Promise<{ tenantsUpdated: number }> {
    const rows = await tx.tenantProduct.findMany({ where: { planSlug, status: 'ACTIVE' }, select: { tenantId: true } });
    const tenantIds = [...new Set(rows.map((r) => r.tenantId))];
    if (tenantIds.length === 0) return { tenantsUpdated: 0 };
    if ((SHARED_KEYS as readonly string[]).includes(key)) {
      for (const tenantId of tenantIds) await writeMergedSharedEntitlements(tx, tenantId);
      return { tenantsUpdated: tenantIds.length };
    }
    const json = entitlementJsonValue(value);
    await tx.tenantEntitlement.updateMany({ where: { key, tenantId: { in: tenantIds } }, data: { value: json } });
    await tx.tenantEntitlement.createMany({ data: tenantIds.map((tenantId) => ({ tenantId, key, value: json })), skipDuplicates: true });
    return { tenantsUpdated: tenantIds.length };
  }
}
