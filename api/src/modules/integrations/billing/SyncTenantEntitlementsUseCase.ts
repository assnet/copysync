import { prisma } from '../../../shared/database/prisma.client';
import { logger } from '../../../shared/logger/logger';

const log = logger.child({ module: 'SyncTenantEntitlementsUseCase' });

export class SyncTenantEntitlementsUseCase {
  async execute(tenantId: string, planSlug: string): Promise<void> {
    const presets = await prisma.planEntitlementPreset.findMany({
      where: { planSlug },
    });

    if (presets.length === 0) {
      log.warn({ tenantId, planSlug }, 'No entitlement presets found for plan');
      return;
    }

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { planSlug },
    });

    for (const preset of presets) {
      await prisma.tenantEntitlement.upsert({
        where: { tenantId_key: { tenantId, key: preset.key } },
        create: { tenantId, key: preset.key, value: preset.value ?? undefined },
        update: { value: preset.value ?? undefined },
      });
    }

    log.info({ tenantId, planSlug, count: presets.length }, 'Tenant entitlements synced');
  }
}
