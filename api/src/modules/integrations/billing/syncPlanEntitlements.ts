import type { TransactionClient } from '../../../shared/database/UnitOfWork';
import { logger } from '../../../shared/logger/logger';
import { applyPlanSideEffects, type PlanSideEffectsResult } from './applyPlanSideEffects';
import { writePlanPreset } from '../../tenants/infrastructure/productEntitlements';

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
  const count = await writePlanPreset(tx, tenantId, planSlug, options.excludeKeys);
  if (count === 0) log.warn({ tenantId, planSlug }, 'No entitlement presets found for plan');
  return applyPlanSideEffects(tx, tenantId);
}
