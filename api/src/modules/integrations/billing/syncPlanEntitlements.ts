import type { TransactionClient } from '../../../shared/database/UnitOfWork';
import { logger } from '../../../shared/logger/logger';
import { applyPlanSideEffects, type PlanSideEffectsResult } from './applyPlanSideEffects';
import { entitlementJsonValue } from './entitlementJsonValue';

const log = logger.child({ module: 'syncPlanEntitlements' });

/**
 * Grava os entitlements do preset do plano e roda os efeitos da troca de plano (rodízio LROT-14,
 * Página de Ofertas STORE-02) na mesma transação. Caminho único do webhook (`ApplyBillingEventUseCase`)
 * e da reconciliação (`PrismaBillingReconcileRepository`): mudou aqui, muda nos dois.
 */
export async function syncPlanEntitlements(
  tx: TransactionClient,
  tenantId: string,
  planSlug: string,
  /** `excludeKeys`: chaves do preset que não são gravadas (plano de produto novo pula as compartilhadas). Vazio = tudo. */
  options: { excludeKeys?: readonly string[] } = {},
): Promise<PlanSideEffectsResult> {
  const presets = await tx.planEntitlementPreset.findMany({ where: { planSlug } });
  if (presets.length === 0) log.warn({ tenantId, planSlug }, 'No entitlement presets found for plan');
  const exclude = new Set(options.excludeKeys ?? []);
  for (const preset of presets) {
    if (exclude.has(preset.key)) continue;
    await tx.tenantEntitlement.upsert({
      where: { tenantId_key: { tenantId, key: preset.key } },
      create: { tenantId, key: preset.key, value: entitlementJsonValue(preset.value) },
      update: { value: entitlementJsonValue(preset.value) },
    });
  }
  return applyPlanSideEffects(tx, tenantId);
}
