import { prisma } from '../../../shared/database/prisma.client';
import { logger } from '../../../shared/logger/logger';
import { applyLinkRotationPlanLimits } from '../../link-rotation/infrastructure/linkRotationPlanLimits';

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

    for (const preset of presets) {
      await prisma.tenantEntitlement.upsert({
        where: { tenantId_key: { tenantId, key: preset.key } },
        create: { tenantId, key: preset.key, value: preset.value ?? 'false' },
        update: { value: preset.value ?? 'false' },
      });
    }

    // Rebaixo/subida de plano: rodízios e grupos excedentes ↔ PAUSED_BY_PLAN (LROT-14)
    const linkRotations = await applyLinkRotationPlanLimits(prisma, tenantId);

    log.info({ tenantId, planSlug, count: presets.length, linkRotations }, 'Tenant entitlements synced');
  }
}
