import { prisma } from '../../../shared/database/prisma.client';
import { logger } from '../../../shared/logger/logger';
import { applyPlanSideEffects } from './applyPlanSideEffects';

const log = logger.child({ module: 'SyncTenantEntitlementsUseCase' });

export class SyncTenantEntitlementsUseCase {
  async execute(tenantId: string, planSlug: string): Promise<void> {
    const presets = await prisma.planEntitlementPreset.findMany({
      where: { planSlug },
    });

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { planSlug },
    });

    if (presets.length === 0) {
      log.warn({ tenantId, planSlug }, 'No entitlement presets found for plan');
      return;
    }

    // Upserts + efeitos do plano no mesmo commit: rodízio (LROT-14) e Página de Ofertas (STORE-02)
    const effects = await prisma.$transaction(async (tx) => {
      for (const preset of presets) {
        await tx.tenantEntitlement.upsert({
          where: { tenantId_key: { tenantId, key: preset.key } },
          create: { tenantId, key: preset.key, value: preset.value ?? 'false' },
          update: { value: preset.value ?? 'false' },
        });
      }
      return applyPlanSideEffects(tx, tenantId);
    });

    log.info({ tenantId, planSlug, count: presets.length, ...effects }, 'Tenant entitlements synced');
  }
}
