import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/database/prisma.client';
import { env } from '../../../shared/config/env';
import { logger } from '../../../shared/logger/logger';
import { internalEventBus } from '../../../shared/events/InternalEventBus';
import { SlugTakenError } from '../../../shared/errors/internal/TeamErrors';
import { PLAN_SLUGS, type PlanSlug } from '../../tenants/domain/planPresets';
import type { ProvisionTenantInput, ProvisionTenantOutput } from '../../tenants/application/use-cases/ProvisionTenantUseCase';
import { ProvisionTenantUseCase } from '../../tenants/application/use-cases/ProvisionTenantUseCase';
import { createEmailSender } from '../infrastructure/email/EmailSenderFactory';
import { applyPlanSideEffects } from './applyPlanSideEffects';
import { buildTenantSlug, tenantNameFrom } from './buildTenantSlug';

const log = logger.child({ module: 'ApplyBillingEventUseCase' });

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Tipos de evento do hub central (contrato do webhook). */
export const BILLING_EVENT_TYPES = [
  'subscription.activated',
  'subscription.renewed',
  'subscription.updated',
  'subscription.payment_failed',
  'subscription.canceled',
  'subscription.expired',
  'subscription.refunded',
  'subscription.chargedback',
  'subscription.trial_ended',
] as const;

export type BillingEventType = (typeof BILLING_EVENT_TYPES)[number];

export function isBillingEventType(type: string): type is BillingEventType {
  return (BILLING_EVENT_TYPES as readonly string[]).includes(type);
}

export interface BillingEventPayload {
  email?: string;
  name?: string;
  planSlug?: string | null;
}

export interface ApplyBillingEventInput {
  eventId: string;
  /** `externalUserId` do hub = `Tenant.billingCustomerId`. */
  billingCustomerId: string;
  /** Texto cru do hub; tipo desconhecido vira recibo IGNORED. */
  eventType: string;
  seq: number;
  payload: BillingEventPayload;
}

/** Desfechos gravados no recibo. */
export type BillingOutcome = 'APPLIED' | 'DUPLICATE' | 'OUT_OF_ORDER' | 'IGNORED';

/** Ativação de cliente novo que não dá para provisionar: sem recibo, o hub retém e reenvia (fila DEAD com replay). */
export type UnprovisionableReason = 'missing_email' | 'invalid_plan_slug';

export type ApplyResult =
  | { outcome: BillingOutcome; tenantId?: string }
  | { outcome: 'UNPROVISIONABLE'; reason: UnprovisionableReason };

export interface TenantProvisioner {
  execute(input: ProvisionTenantInput): Promise<ProvisionTenantOutput>;
}

type TxClient = Prisma.TransactionClient;
interface LockedTenantRow {
  id: string;
  status: string;
  lastBillingEventSeq: number | null;
}

/* ------------------------------------------------------------------ */
/*  Regras do contrato                                                 */
/* ------------------------------------------------------------------ */

const ACTIVATING = new Set<BillingEventType>(['subscription.activated', 'subscription.renewed']);
const PLAN_SYNC = new Set<BillingEventType>(['subscription.activated', 'subscription.renewed', 'subscription.updated']);
const CANCELLING = new Set<BillingEventType>([
  'subscription.canceled',
  'subscription.expired',
  'subscription.refunded',
  'subscription.chargedback',
]);
const MAX_SLUG_ATTEMPTS = 3;
/** Teto explícito da transação (lock + entitlements + efeitos do plano). */
const TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;

type TxResult = { outcome: BillingOutcome; tenantId?: string; suspended?: boolean };

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/* ------------------------------------------------------------------ */
/*  Use case                                                           */
/* ------------------------------------------------------------------ */

export class ApplyBillingEventUseCase {
  constructor(private readonly provisioner?: TenantProvisioner) {}

  async execute(input: ApplyBillingEventInput): Promise<ApplyResult> {
    const { eventId, billingCustomerId, seq } = input;
    const type = isBillingEventType(input.eventType) ? input.eventType : null;
    const planSlug = this.resolvePlanSlug(input);

    if (type === 'subscription.activated') {
      const reason = await this.provisionIfUnknown(input, planSlug);
      if (reason) {
        log.error({ eventId, externalUserId: billingCustomerId, reason }, 'Billing activation cannot provision tenant; receipt not written so the hub retries');
        return { outcome: 'UNPROVISIONABLE', reason };
      }
    }

    let result: TxResult;
    try {
      result = await prisma.$transaction((tx) => this.applyInTx(tx, input, type, planSlug), TX_OPTIONS);
    } catch (err) {
      // Mesmo eventId gravado por requisição concorrente: a unique do recibo decide
      if (isUniqueViolation(err) && (await prisma.billingEventReceipt.findUnique({ where: { eventId } }))) {
        log.info({ eventId }, 'Duplicate billing event (concurrent)');
        return { outcome: 'DUPLICATE' };
      }
      throw err;
    }

    if (result.suspended && result.tenantId) {
      internalEventBus.emit('TENANT_SUSPENDED', { type: 'TENANT_SUSPENDED', tenantId: result.tenantId });
    }
    log.info({ eventId, eventType: input.eventType, seq, outcome: result.outcome, tenantId: result.tenantId }, 'Billing event handled');
    return { outcome: result.outcome, tenantId: result.tenantId };
  }

  /** planSlug válido ou null; inválido não grava plano nem entitlements. */
  private resolvePlanSlug(input: ApplyBillingEventInput): PlanSlug | null {
    const raw = input.payload.planSlug;
    if (raw == null || raw === '') return null;
    if ((PLAN_SLUGS as readonly string[]).includes(raw)) return raw as PlanSlug;
    log.warn({ eventId: input.eventId, planSlug: raw }, 'Billing event with unknown planSlug; plan not applied');
    return null;
  }

  /** Provisiona cliente novo; devolve o motivo quando não dá (null = tenant existe ou foi criado). */
  private async provisionIfUnknown(input: ApplyBillingEventInput, planSlug: PlanSlug | null): Promise<UnprovisionableReason | null> {
    const { eventId, billingCustomerId } = input;
    const [receipt, tenant] = await Promise.all([
      prisma.billingEventReceipt.findUnique({ where: { eventId } }),
      prisma.tenant.findUnique({ where: { billingCustomerId }, select: { id: true } }),
    ]);
    if (receipt || tenant) return null;
    const email = input.payload.email;
    if (!email) return 'missing_email';
    if (!planSlug) return 'invalid_plan_slug';

    const provisioner = this.provisioner ?? new ProvisionTenantUseCase(
      createEmailSender({ mode: env.EMAIL_SENDER, smtpUrl: env.EMAIL_SMTP_URL, from: env.EMAIL_FROM }),
    );
    const name = tenantNameFrom(input.payload.name, email);

    for (let attempt = 1; ; attempt++) {
      try {
        const out = await provisioner.execute({
          name,
          slug: buildTenantSlug(name),
          owner: { email, name },
          billingCustomerId,
          planSlug,
          origin: 'BILLING_WEBHOOK',
        });
        log.info({ eventId, tenantId: out.tenantId }, 'Tenant provisioned from billing event');
        return null;
      } catch (err) {
        if (err instanceof SlugTakenError && attempt < MAX_SLUG_ATTEMPTS) continue;
        // Activated concorrente já criou o tenant deste cliente: segue com ele
        if (isUniqueViolation(err) && (await prisma.tenant.findUnique({ where: { billingCustomerId }, select: { id: true } }))) {
          log.info({ eventId }, 'Tenant already provisioned by a concurrent billing event');
          return null;
        }
        throw err;
      }
    }
  }

  private async applyInTx(
    tx: TxClient,
    input: ApplyBillingEventInput,
    type: BillingEventType | null,
    planSlug: PlanSlug | null,
  ): Promise<TxResult> {
    const { eventId, billingCustomerId, seq } = input;

    // Trava a linha do tenant: eventos do mesmo cliente serializam até o commit
    const rows = await tx.$queryRaw<LockedTenantRow[]>`
      SELECT "id", "status"::text AS "status", "lastBillingEventSeq"
        FROM "tenants" WHERE "billingCustomerId" = ${billingCustomerId}
       FOR UPDATE`;
    const tenant = rows[0] ?? null;

    if (await tx.billingEventReceipt.findUnique({ where: { eventId } })) {
      return { outcome: 'DUPLICATE', tenantId: tenant?.id };
    }

    const receipt = (outcome: BillingOutcome) =>
      tx.billingEventReceipt.create({
        data: { eventId, billingCustomerId, tenantId: tenant?.id ?? null, type: input.eventType, seq, outcome },
      });

    if (!tenant) {
      log.warn({ eventId, eventType: input.eventType }, 'Tenant not found for billing customer');
      await receipt('IGNORED');
      return { outcome: 'IGNORED' };
    }
    if (tenant.lastBillingEventSeq !== null && seq <= tenant.lastBillingEventSeq) {
      log.info({ eventId, seq, lastSeq: tenant.lastBillingEventSeq }, 'Out-of-order billing event');
      await receipt('OUT_OF_ORDER');
      return { outcome: 'OUT_OF_ORDER', tenantId: tenant.id };
    }
    const advanceWatermark = () =>
      tx.tenant.updateMany({
        where: { id: tenant.id, OR: [{ lastBillingEventSeq: null }, { lastBillingEventSeq: { lt: seq } }] },
        data: { lastBillingEventSeq: seq },
      });
    // Sem efeito, mas o seq conta: evento mais antigo que chegue depois vira OUT_OF_ORDER
    if (!type || type === 'subscription.trial_ended') {
      if (!type) log.warn({ eventId, eventType: input.eventType }, 'Unknown billing event type');
      await advanceWatermark();
      await receipt('IGNORED');
      return { outcome: 'IGNORED', tenantId: tenant.id };
    }

    const data: Prisma.TenantUpdateInput = {};
    let suspended = false;
    if (ACTIVATING.has(type)) {
      data.status = 'ACTIVE';
      data.suspendedAt = null;
    } else if (type === 'subscription.payment_failed') {
      data.status = 'SUSPENDED';
      data.suspendedAt = new Date();
      suspended = true;
    } else if (CANCELLING.has(type)) {
      data.status = 'CANCELLED';
      data.suspendedAt = new Date();
      suspended = true;
    }
    const syncPlan = planSlug !== null && PLAN_SYNC.has(type);
    if (syncPlan) data.planSlug = planSlug;

    if (Object.keys(data).length > 0) {
      await tx.tenant.update({ where: { id: tenant.id }, data });
    }

    if (syncPlan) {
      const presets = await tx.planEntitlementPreset.findMany({ where: { planSlug } });
      if (presets.length === 0) log.warn({ tenantId: tenant.id, planSlug }, 'No entitlement presets found for plan');
      for (const preset of presets) {
        await tx.tenantEntitlement.upsert({
          where: { tenantId_key: { tenantId: tenant.id, key: preset.key } },
          create: { tenantId: tenant.id, key: preset.key, value: preset.value ?? 'false' },
          update: { value: preset.value ?? 'false' },
        });
      }
      // Rodízio (LROT-14) e Página de Ofertas (STORE-02) no mesmo commit dos entitlements
      await applyPlanSideEffects(tx, tenant.id);
    }

    await advanceWatermark();
    await receipt('APPLIED');
    return { outcome: 'APPLIED', tenantId: tenant.id, suspended };
  }
}
