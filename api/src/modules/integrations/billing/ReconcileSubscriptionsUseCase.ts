import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma.client';
import { env } from '../../../shared/config/env';
import { logger } from '../../../shared/logger/logger';

const log = logger.child({ module: 'ReconcileSubscriptionsUseCase' });
const LEASE_NAME = 'billing-reconcile';

export class ReconcileSubscriptionsUseCase {
  private readonly ownerId = randomUUID();

  async execute(): Promise<void> {
    if (!env.BILLING_ENABLED) return;

    const acquired = await this.acquireLease();
    if (!acquired) {
      log.debug('Lease held by another process, skipping reconciliation');
      return;
    }

    try {
      const tenants = await prisma.tenant.findMany({
        where: {
          billingCustomerId: { not: null },
          status: { in: ['ACTIVE', 'SUSPENDED'] },
        },
        select: { id: true, billingCustomerId: true, planSlug: true },
      });

      log.info({ count: tenants.length }, 'Starting billing reconciliation');

      for (const tenant of tenants) {
        try {
          await this.reconcileTenant(tenant);
        } catch (err) {
          log.error({ err, tenantId: tenant.id }, 'Failed to reconcile tenant');
        }
      }

      log.info({ count: tenants.length }, 'Billing reconciliation completed');
    } finally {
      await this.releaseLease();
    }
  }

  private async reconcileTenant(_tenant: {
    id: string;
    billingCustomerId: string | null;
    planSlug: string | null;
  }): Promise<void> {
    // M2M GET /integrations/subscriptions?externalUserId= not yet implemented on hub side
    // Placeholder: when H2 is ready, fetch subscription state and compare with local
  }

  private async acquireLease(): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + env.BILLING_RECONCILE_LEASE_TTL_MS);
    const { count } = await prisma.jobLease.updateMany({
      where: { name: LEASE_NAME, expiresAt: { lt: now } },
      data: { ownerId: this.ownerId, expiresAt },
    });
    if (count > 0) return true;
    try {
      await prisma.jobLease.create({
        data: { name: LEASE_NAME, ownerId: this.ownerId, expiresAt },
      });
      return true;
    } catch {
      return false;
    }
  }

  private async releaseLease(): Promise<void> {
    try {
      await prisma.jobLease.deleteMany({
        where: { name: LEASE_NAME, ownerId: this.ownerId },
      });
    } catch (err) {
      log.error({ err }, 'Failed to release reconciliation lease');
    }
  }
}
