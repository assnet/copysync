import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/database/prisma.client';
import { logger } from '../../../shared/logger/logger';
import { internalEventBus } from '../../../shared/events/InternalEventBus';

const log = logger.child({ module: 'ApplyBillingEventUseCase' });

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type BillingEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'subscription.renewed'
  | 'payment.succeeded'
  | 'payment.failed';

export interface ApplyBillingEventInput {
  eventId: string;
  billingCustomerId: string;
  eventType: BillingEventType;
  seq: number;
  payload: Record<string, unknown>;
}

type BillingOutcome = 'APPLIED' | 'DUPLICATE' | 'OUT_OF_ORDER' | 'IGNORED';

interface ApplyResult {
  outcome: BillingOutcome;
  tenantId?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const PLAN_EVENTS = new Set<BillingEventType>([
  'subscription.created',
  'subscription.updated',
  'subscription.renewed',
]);

function extractPlanSlug(payload: Record<string, unknown>): string | undefined {
  return typeof payload.planSlug === 'string' ? payload.planSlug : undefined;
}

/* ------------------------------------------------------------------ */
/*  Use case                                                           */
/* ------------------------------------------------------------------ */

export class ApplyBillingEventUseCase {
  async execute(input: ApplyBillingEventInput): Promise<ApplyResult> {
    const { eventId, billingCustomerId, eventType, seq, payload } = input;

    // 1. Duplicate check
    const existing = await prisma.billingEventReceipt.findUnique({
      where: { eventId },
    });

    if (existing) {
      log.info({ eventId }, 'Duplicate billing event');
      return { outcome: 'DUPLICATE' };
    }

    // 2. Find tenant by billingCustomerId
    const tenant = await prisma.tenant.findUnique({
      where: { billingCustomerId },
    });

    if (!tenant) {
      await prisma.billingEventReceipt.create({
        data: {
          eventId,
          billingCustomerId,
          type: eventType,
          seq,
          outcome: 'IGNORED',
        },
      });
      log.warn({ eventId, billingCustomerId }, 'Tenant not found for billing customer');
      return { outcome: 'IGNORED' };
    }

    // 3. Sequence check
    if (
      tenant.lastBillingEventSeq !== null &&
      tenant.lastBillingEventSeq !== undefined &&
      seq <= tenant.lastBillingEventSeq
    ) {
      await prisma.billingEventReceipt.create({
        data: {
          eventId,
          billingCustomerId,
          tenantId: tenant.id,
          type: eventType,
          seq,
          outcome: 'OUT_OF_ORDER',
        },
      });
      log.info({ eventId, seq, lastSeq: tenant.lastBillingEventSeq }, 'Out-of-order billing event');
      return { outcome: 'OUT_OF_ORDER' };
    }

    // 4. Process event inside a transaction
    await prisma.$transaction(async (tx) => {
      // 4a. Plan-related events
      if (PLAN_EVENTS.has(eventType)) {
        const planSlug = extractPlanSlug(payload);

        if (planSlug) {
          await tx.tenant.update({
            where: { id: tenant.id },
            data: { planSlug },
          });

          // Sync entitlements inline
          const presets = await tx.planEntitlementPreset.findMany({
            where: { planSlug },
          });

          for (const preset of presets) {
            await tx.tenantEntitlement.upsert({
              where: { tenantId_key: { tenantId: tenant.id, key: preset.key } },
              create: { tenantId: tenant.id, key: preset.key, value: preset.value ?? undefined },
              update: { value: preset.value ?? undefined },
            });
          }
        }

        // Reactivate if not active
        if (tenant.status !== 'ACTIVE') {
          await tx.tenant.update({
            where: { id: tenant.id },
            data: { status: 'ACTIVE', suspendedAt: null },
          });
        }
      }

      // 4b. Subscription cancelled
      if (eventType === 'subscription.cancelled') {
        await tx.tenant.update({
          where: { id: tenant.id },
          data: { status: 'CANCELLED', suspendedAt: new Date() },
        });
      }

      // 4c. Payment failed
      if (eventType === 'payment.failed') {
        await tx.tenant.update({
          where: { id: tenant.id },
          data: { status: 'SUSPENDED', suspendedAt: new Date() },
        });
      }

      // 4d. Payment succeeded — reactivate if suspended
      if (eventType === 'payment.succeeded' && tenant.status === 'SUSPENDED') {
        await tx.tenant.update({
          where: { id: tenant.id },
          data: { status: 'ACTIVE', suspendedAt: null },
        });
      }

      // 5. Advance seq watermark (conditional)
      await tx.tenant.updateMany({
        where: {
          id: tenant.id,
          OR: [
            { lastBillingEventSeq: null },
            { lastBillingEventSeq: { lt: seq } },
          ],
        },
        data: { lastBillingEventSeq: seq },
      });

      // 6. Store receipt as APPLIED
      await tx.billingEventReceipt.create({
        data: {
          eventId,
          billingCustomerId,
          tenantId: tenant.id,
          type: eventType,
          seq,
          outcome: 'APPLIED',
        },
      });
    });

    // 7. Emit events (outside transaction — fire-and-forget)
    if (eventType === 'subscription.cancelled' || eventType === 'payment.failed') {
      internalEventBus.emit('TENANT_SUSPENDED', {
        type: 'TENANT_SUSPENDED',
        tenantId: tenant.id,
      });
    }

    log.info({ tenantId: tenant.id, eventType, eventId, seq }, 'Billing event applied');
    return { outcome: 'APPLIED', tenantId: tenant.id };
  }
}
