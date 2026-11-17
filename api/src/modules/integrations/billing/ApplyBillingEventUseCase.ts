import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/database/prisma.client';
import { logger } from '../../../shared/logger/logger';
import { internalEventBus } from '../../../shared/events/InternalEventBus';
import { SlugTakenError } from '../../../shared/errors/internal/TeamErrors';
import type { PlanSlug } from '../../tenants/domain/planPresets';
import { resolvePlan, type ResolvedPlan } from '../../tenants/domain/planCatalog';
import { isLegacyProduct, type ProductKey } from '../../tenants/domain/services/resolveProductAccess';
import { createTenantProductRepository, productAccessReader } from '../../tenants/infrastructure/productAccessContainer';
import type { ProvisionTenantInput, ProvisionTenantOutput } from '../../tenants/application/use-cases/ProvisionTenantUseCase';
import { ProvisionTenantUseCase } from '../../tenants/application/use-cases/ProvisionTenantUseCase';
import { normalizeEmail } from '../../../shared/utils/normalizeEmail';
import { PrismaAuditLogRepository } from '../../../shared/audit/PrismaAuditLogRepository';
import { createEmailSenderFromEnv } from '../infrastructure/email/EmailSenderFactory';
import { syncPlanEntitlements } from './syncPlanEntitlements';
import type { HubSubscriptionsFailure, IHubSubscriptionsClient } from '../application/ports/IHubSubscriptionsClient';
import { graceMsFromHours, pickGrantingByProduct, pickGrantingSubscription, unknownPlanPermissions, type HubSubscriptionSnapshot, type ProductGrantingPick } from '../domain/services/subscriptionReconcile';
import { syncProductPlanEntitlements, writeBillingProductRow } from './productBilling';
import { writeMergedSharedEntitlements } from '../../tenants/infrastructure/productEntitlements';
import { env } from '../../../shared/config/env';
import { createHubSubscriptionsClientFromEnv } from '../infrastructure/billing/createReconcileSubscriptionsUseCase';
import { buildTenantSlug, tenantNameFrom } from './buildTenantSlug';
import { parseExpiresAt } from './parseExpiresAt';

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
  /**
   * Permissões efetivas da assinatura (central). A `COPYSYNC_*` mais alta define o nível; ausente
   * ou vazia (central antiga) = nível pelo `planSlug`. Desconhecida só gera log.
   */
  permissions?: string[];
  /** Vencimento ISO do hub; `null` = sem vencimento; ausente = mantém o gravado. */
  expiresAt?: string | null;
}

export interface ApplyBillingEventInput {
  eventId: string;
  /** `externalUserId` do hub = `Tenant.billingCustomerId`. */
  billingCustomerId: string;
  /** Texto cru do hub; tipo desconhecido vira recibo IGNORED. */
  eventType: string;
  /** Sequência global da central (BigInt no hub e no banco): nunca `number`. */
  seq: bigint;
  payload: BillingEventPayload;
}

/** Desfechos gravados no recibo. `KEPT_ACTIVE` = evento de corte com outra assinatura válida (união). */
export type BillingOutcome = 'APPLIED' | 'DUPLICATE' | 'OUT_OF_ORDER' | 'IGNORED' | 'KEPT_ACTIVE';

/** Ativação de cliente novo que não dá para provisionar: sem recibo, o hub retém e reenvia (fila DEAD com replay). */
export type UnprovisionableReason = 'missing_email' | 'invalid_plan_slug';

export type ApplyResult =
  | { outcome: BillingOutcome; tenantId?: string }
  | { outcome: 'UNPROVISIONABLE'; reason: UnprovisionableReason }
  /** Evento de corte sem resposta da central: sem recibo, a rota responde 503 e a central retenta. */
  | { outcome: 'HUB_UNAVAILABLE'; reason: HubSubscriptionsFailure | 'lookup_required' };

export interface TenantProvisioner {
  execute(input: ProvisionTenantInput): Promise<ProvisionTenantOutput>;
}

type TxClient = Prisma.TransactionClient;
interface LockedTenantRow {
  id: string;
  status: string;
  lastBillingEventSeq: bigint | null;
  /** Bloqueio do super-admin: o webhook nunca muda o status (só plano/vencimento/watermark). */
  adminBlockedAt: Date | null;
  /** Há linha em `tenant_products` (tenant multi-produto). Ausente/false = caminho de hoje, sem tocar produtos. */
  hasProductRows?: boolean;
  /** Há linha `AFFILIATES` em `tenant_products`. */
  hasAffiliatesRow?: boolean;
}

/** Tenant existente (criado sem `billingCustomerId`) que recebe o cliente da central pelo e-mail do dono. */
interface LinkCandidate {
  tenantId: string;
  ownerUserId: string;
}

type ProvisionDecision = { reason: UnprovisionableReason } | { link: LinkCandidate | null };

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
/** Eventos que cortam acesso: decididos pela união das assinaturas na central (PAYMENT_FAILED tem tolerância). */
const UNION_DECIDED = new Set<BillingEventType>([...CANCELLING, 'subscription.payment_failed']);
/** Falha da consulta que não se resolve sozinha (credencial, cliente, contrato): log `error`. */
const PERSISTENT_LOOKUP_FAILURES = new Set<string>(['unauthorized', 'invalid_response']);
/** Contador por motivo, por processo, só para o log (observabilidade; não decide nada). */
const lookupFailures = new Map<string, number>();

/** Chave do contador e gravidade: 401/403, corpo inválido, 404 e 400 não se resolvem com retry. */
export function classifyHubLookupFailure(reason: string, status?: number): { key: string; persistent: boolean } {
  const clientError = status === 404 || status === 400;
  return { key: clientError ? `${reason}_${status}` : reason, persistent: clientError || PERSISTENT_LOOKUP_FAILURES.has(reason) };
}

/** Cópia do contador por motivo desde o boot (teste/diagnóstico). */
export function hubLookupFailureCounts(): Record<string, number> {
  return Object.fromEntries(lookupFailures);
}
const MAX_SLUG_ATTEMPTS = 3;
/** Teto explícito da transação (lock + entitlements + efeitos do plano). */
const TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;

type TxResult = { outcome: BillingOutcome; tenantId?: string; suspended?: boolean; productsTouched?: boolean };

/** Evento de corte chegou à transação sem a consulta à central (tenant apareceu entre a leitura e a trava). */
class UnionLookupRequiredError extends Error {}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/* ------------------------------------------------------------------ */
/*  Use case                                                           */
/* ------------------------------------------------------------------ */

export class ApplyBillingEventUseCase {
  constructor(
    private readonly provisioner?: TenantProvisioner,
    private readonly subscriptions?: IHubSubscriptionsClient,
  ) {}

  async execute(input: ApplyBillingEventInput): Promise<ApplyResult> {
    const { eventId, billingCustomerId, seq } = input;
    const type = isBillingEventType(input.eventType) ? input.eventType : null;
    const resolved = this.resolvePlan(input);
    // Afiliados segue em `planSlug` (caminho de hoje); produto novo só em `newPlan`
    const planSlug: PlanSlug | null = resolved?.product === 'AFFILIATES' ? (resolved.planSlug as PlanSlug) : null;
    const newPlan: ResolvedPlan | null = resolved && resolved.product !== 'AFFILIATES' ? resolved : null;

    let link: LinkCandidate | null = null;
    if (type === 'subscription.activated') {
      const decision = await this.provisionIfUnknown(input, resolved);
      if ('reason' in decision) {
        const { reason } = decision;
        log.error({ eventId, externalUserId: billingCustomerId, reason }, 'Billing activation cannot provision tenant; receipt not written so the hub retries');
        return { outcome: 'UNPROVISIONABLE', reason };
      }
      link = decision.link;
    }

    // Corte decidido pela união das assinaturas na central; consulta FORA da transação (sem segurar a trava)
    let snapshot: HubSubscriptionSnapshot | null = null;
    const lookup = type !== null && (
      (UNION_DECIDED.has(type) && (await this.needsUnionLookup(input)))
      || (newPlan !== null && ACTIVATING.has(type) && (await this.needsProductActivationLookup(input)))
    );
    if (lookup) {
      const res = await (this.subscriptions ?? createHubSubscriptionsClientFromEnv()).fetchByCustomer(billingCustomerId);
      if (!res.ok) {
        const { key, persistent } = classifyHubLookupFailure(res.reason, res.status);
        const count = (lookupFailures.get(key) ?? 0) + 1;
        lookupFailures.set(key, count);
        const ctx = { eventId, eventType: type, reason: res.reason, status: res.status, failuresSinceBoot: count };
        if (persistent) log.error(ctx, 'Hub subscriptions lookup failing persistently (check credentials/customer/contract); cut event not applied, hub will retry');
        else log.warn(ctx, 'Hub subscriptions lookup failed; cut event not applied, hub will retry');
        return { outcome: 'HUB_UNAVAILABLE', reason: res.reason };
      }
      snapshot = res.snapshot;
    }

    let result: TxResult;
    try {
      result = await prisma.$transaction((tx) => this.applyInTx(tx, input, type, planSlug, link, snapshot, newPlan), TX_OPTIONS);
    } catch (err) {
      if (err instanceof UnionLookupRequiredError) {
        log.warn({ eventId }, 'Cut event reached transaction without hub lookup; hub will retry');
        return { outcome: 'HUB_UNAVAILABLE', reason: 'lookup_required' };
      }
      // Mesmo eventId gravado por requisição concorrente: a unique do recibo decide
      if (isUniqueViolation(err) && (await prisma.billingEventReceipt.findUnique({ where: { eventId } }))) {
        log.info({ eventId }, 'Duplicate billing event (concurrent)');
        return { outcome: 'DUPLICATE' };
      }
      throw err;
    }

    if (result.productsTouched && result.tenantId) productAccessReader().invalidate(result.tenantId);
    if (result.suspended && result.tenantId) {
      internalEventBus.emit('TENANT_SUSPENDED', { type: 'TENANT_SUSPENDED', tenantId: result.tenantId });
    }
    log.info({ eventId, eventType: input.eventType, seq: seq.toString(), outcome: result.outcome, tenantId: result.tenantId }, 'Billing event handled');
    return { outcome: result.outcome, tenantId: result.tenantId };
  }

  /** Consulta só quando o evento vai ter efeito: sem recibo, com tenant e seq acima da marca d’água. */
  private async needsUnionLookup(input: ApplyBillingEventInput): Promise<boolean> {
    const [receipt, tenant] = await Promise.all([
      prisma.billingEventReceipt.findUnique({ where: { eventId: input.eventId } }),
      prisma.tenant.findUnique({ where: { billingCustomerId: input.billingCustomerId }, select: { id: true, lastBillingEventSeq: true } }),
    ]);
    if (receipt || !tenant) return false;
    return tenant.lastBillingEventSeq === null || input.seq > tenant.lastBillingEventSeq;
  }

  /**
   * PROD-14: ativação de produto novo que vai reativar tenant não `ACTIVE` sem linha `AFFILIATES` decide
   * Afiliados pelo snapshot da central (mesmas condições de efeito do corte).
   */
  private async needsProductActivationLookup(input: ApplyBillingEventInput): Promise<boolean> {
    const [receipt, tenant] = await Promise.all([
      prisma.billingEventReceipt.findUnique({ where: { eventId: input.eventId } }),
      prisma.tenant.findUnique({ where: { billingCustomerId: input.billingCustomerId }, select: { id: true, status: true, lastBillingEventSeq: true } }),
    ]);
    if (receipt || !tenant || tenant.status === 'ACTIVE') return false;
    if (tenant.lastBillingEventSeq !== null && input.seq <= tenant.lastBillingEventSeq) return false;
    return (await createTenantProductRepository().find(tenant.id, 'AFFILIATES')) === null;
  }

  /**
   * Produto e plano: Afiliados pela permissão `COPYSYNC_*` mais alta ou, sem ela, pelo planSlug (mesma
   * regra da reconciliação); produto novo pela família dele (`resolvePlan`). Nada válido = null.
   */
  private resolvePlan(input: ApplyBillingEventInput): ResolvedPlan | null {
    const { planSlug: raw, permissions } = input.payload;
    const unknown = unknownPlanPermissions(permissions);
    if (unknown.length > 0) log.warn({ eventId: input.eventId, permissions: unknown }, 'Billing event with unknown permissions; ignored');
    const slug = resolvePlan(raw, permissions);
    if (slug) return slug;
    if (raw != null && raw !== '') log.warn({ eventId: input.eventId, planSlug: raw }, 'Billing event with unknown planSlug; plan not applied');
    return null;
  }

  /**
   * Cliente novo: vincula pelo e-mail ao tenant único do dono sem `billingCustomerId` ou provisiona.
   * Devolve o motivo quando não dá; `link` = vincular na transação; `link: null` = tenant existe ou foi criado.
   */
  private async provisionIfUnknown(input: ApplyBillingEventInput, resolved: ResolvedPlan | null): Promise<ProvisionDecision> {
    const { eventId, billingCustomerId } = input;
    const [receipt, tenant] = await Promise.all([
      prisma.billingEventReceipt.findUnique({ where: { eventId } }),
      prisma.tenant.findUnique({ where: { billingCustomerId }, select: { id: true } }),
    ]);
    if (receipt || tenant) return { link: null };
    const email = input.payload.email;
    if (!email) return { reason: 'missing_email' };
    if (!resolved) return { reason: 'invalid_plan_slug' };
    const affiliates = resolved.product === 'AFFILIATES';

    const link = await this.findLinkCandidate(eventId, email);
    if (link) return { link };

    const provisioner = this.provisioner ?? new ProvisionTenantUseCase(
      createEmailSenderFromEnv(),
    );
    const name = tenantNameFrom(input.payload.name, email);

    for (let attempt = 1; ; attempt++) {
      try {
        const out = await provisioner.execute({
          name,
          slug: buildTenantSlug(name),
          owner: { email, name },
          billingCustomerId,
          planSlug: affiliates ? resolved.planSlug : undefined,
          origin: 'BILLING_WEBHOOK',
          ...(affiliates ? {} : { initialProducts: [{ product: resolved.product, planSlug: resolved.planSlug }] }),
        });
        log.info({ eventId, tenantId: out.tenantId }, 'Tenant provisioned from billing event');
        return { link: null };
      } catch (err) {
        if (err instanceof SlugTakenError && attempt < MAX_SLUG_ATTEMPTS) continue;
        // Activated concorrente já criou o tenant deste cliente: segue com ele
        if (isUniqueViolation(err) && (await prisma.tenant.findUnique({ where: { billingCustomerId }, select: { id: true } }))) {
          log.info({ eventId }, 'Tenant already provisioned by a concurrent billing event');
          return { link: null };
        }
        throw err;
      }
    }
  }

  /**
   * Elegível só quando o usuário do e-mail é ADMIN de exatamente um tenant e esse tenant não tem
   * `billingCustomerId`; qualquer tenant dele já vinculado a outro cliente torna o caso ambíguo.
   * Ambíguo = provisiona como antes, com aviso (só ids, nunca o e-mail).
   */
  private async findLinkCandidate(eventId: string, email: string): Promise<LinkCandidate | null> {
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) }, select: { id: true } });
    if (!user) return null;
    const owned = await prisma.userTenant.findMany({
      where: { userId: user.id, role: 'ADMIN' },
      select: { tenantId: true, tenant: { select: { billingCustomerId: true } } },
    });
    const unlinked = owned.filter((m) => m.tenant.billingCustomerId === null);
    if (unlinked.length === 1 && owned.length === 1) return { tenantId: unlinked[0]!.tenantId, ownerUserId: user.id };
    log.warn(
      { eventId, userId: user.id, unlinkedTenantIds: unlinked.map((m) => m.tenantId), linkedTenants: owned.length - unlinked.length },
      'Billing customer not linked by email (owner tenants ambiguous or none); provisioning a new tenant',
    );
    return null;
  }

  /** Trava o tenant do cliente da central (eventos do mesmo cliente serializam até o commit). */
  private lockByCustomer(tx: TxClient, billingCustomerId: string): Promise<LockedTenantRow[]> {
    return tx.$queryRaw<LockedTenantRow[]>`
      SELECT "id", "status"::text AS "status", "lastBillingEventSeq", "adminBlockedAt",
             EXISTS (SELECT 1 FROM "tenant_products" tp WHERE tp."tenantId" = "tenants"."id") AS "hasProductRows",
             EXISTS (SELECT 1 FROM "tenant_products" tp WHERE tp."tenantId" = "tenants"."id" AND tp."product" = 'AFFILIATES') AS "hasAffiliatesRow"
        FROM "tenants" WHERE "billingCustomerId" = ${billingCustomerId}
       FOR UPDATE`;
  }

  /**
   * Trava o candidato ainda sem cliente e confere que o dono continua ADMIN. Se outra requisição do
   * mesmo cliente vinculou antes, o FOR UPDATE espera o commit e a nova leitura por cliente acha.
   * Corrida perdida para outro cliente: erro sem recibo, o hub reenvia e o próximo passo reavalia.
   */
  private async lockLinkCandidate(
    tx: TxClient,
    billingCustomerId: string,
    link: LinkCandidate,
  ): Promise<{ tenant: LockedTenantRow; linkPending: boolean }> {
    const rows = await tx.$queryRaw<LockedTenantRow[]>`
      SELECT "id", "status"::text AS "status", "lastBillingEventSeq", "adminBlockedAt",
             EXISTS (SELECT 1 FROM "tenant_products" tp WHERE tp."tenantId" = "tenants"."id") AS "hasProductRows",
             EXISTS (SELECT 1 FROM "tenant_products" tp WHERE tp."tenantId" = "tenants"."id" AND tp."product" = 'AFFILIATES') AS "hasAffiliatesRow"
        FROM "tenants" WHERE "id" = ${link.tenantId} AND "billingCustomerId" IS NULL
       FOR UPDATE`;
    if (rows[0]) {
      const owner = await tx.userTenant.findFirst({
        where: { userId: link.ownerUserId, tenantId: link.tenantId, role: 'ADMIN' },
        select: { id: true },
      });
      if (owner) return { tenant: rows[0], linkPending: true };
    }
    const again = await this.lockByCustomer(tx, billingCustomerId);
    if (again[0]) return { tenant: again[0], linkPending: false };
    log.warn({ tenantId: link.tenantId, userId: link.ownerUserId }, 'Billing link candidate changed before lock; hub will retry');
    throw new Error('Billing link candidate changed concurrently');
  }

  private async applyInTx(
    tx: TxClient,
    input: ApplyBillingEventInput,
    type: BillingEventType | null,
    planSlug: PlanSlug | null,
    link: LinkCandidate | null = null,
    snapshot: HubSubscriptionSnapshot | null = null,
    newPlan: ResolvedPlan | null = null,
  ): Promise<TxResult> {
    const { eventId, billingCustomerId, seq } = input;

    // Trava a linha do tenant: eventos do mesmo cliente serializam até o commit
    let locked: LockedTenantRow | null = (await this.lockByCustomer(tx, billingCustomerId))[0] ?? null;
    let linkPending = false;
    if (!locked && link) ({ tenant: locked, linkPending } = await this.lockLinkCandidate(tx, billingCustomerId, link));
    const tenant = locked;

    if (await tx.billingEventReceipt.findUnique({ where: { eventId } })) {
      return { outcome: 'DUPLICATE', tenantId: tenant?.id };
    }

    // Vínculo pelo e-mail no mesmo commit do recibo e da marca d’água: reentrega acha pelo cliente
    if (tenant && link && linkPending) {
      await tx.tenant.update({ where: { id: tenant.id }, data: { billingCustomerId } });
      await new PrismaAuditLogRepository(tx).create({
        tenantId: tenant.id,
        action: 'TENANT_UPDATED',
        meta: { origin: 'BILLING_WEBHOOK', change: 'billing_customer_linked', eventId, billingCustomerId, ownerUserId: link.ownerUserId },
      });
      log.info({ eventId, tenantId: tenant.id, userId: link.ownerUserId }, 'Existing tenant linked to billing customer by owner email');
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
      log.info({ eventId, seq: seq.toString(), lastSeq: tenant.lastBillingEventSeq.toString() }, 'Out-of-order billing event');
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
    let kept = false;
    let syncSlug: PlanSlug | null = planSlug !== null && PLAN_SYNC.has(type) ? planSlug : null;
    const adminBlocked = Boolean(tenant.adminBlockedAt);
    const wasActive = tenant.status === 'ACTIVE';
    // Bloqueio do super-admin vence sempre: status nunca muda; suspendedAt só é gravado na saída de ACTIVE
    const block = (status: 'SUSPENDED' | 'CANCELLED') => {
      if (adminBlocked) return;
      data.status = status;
      if (wasActive) {
        data.suspendedAt = new Date();
        suspended = true;
      }
    };
    const unblock = () => {
      if (adminBlocked) return;
      data.status = 'ACTIVE';
      data.suspendedAt = null;
    };
    // Por produto (docs/acesso-por-produto.md); tenant sem linha de produto e evento de Afiliados = caminho de hoje
    let affiliatesWrite: { active: boolean } | null = null;
    let cutPick: ProductGrantingPick | null = null;
    let blocked = false;
    if (ACTIVATING.has(type)) {
      unblock();
      if (newPlan && !wasActive && !tenant.hasAffiliatesRow) {
        // PROD-14: decide Afiliados pelo snapshot da central, nunca pelo status local
        if (!snapshot) throw new UnionLookupRequiredError();
        const byProduct = pickGrantingByProduct(snapshot.subscriptions, new Date(), graceMsFromHours(env.BILLING_GRACE_HOURS));
        if (!byProduct.legacyGrants) affiliatesWrite = { active: false };
      } else if (!newPlan && tenant.hasAffiliatesRow) {
        affiliatesWrite = { active: true };
      }
    } else if (UNION_DECIDED.has(type)) {
      // União (regra do PulsoSocial): alguma assinatura do cliente ainda dá acesso → mantém
      if (!snapshot) throw new UnionLookupRequiredError();
      const now = new Date();
      const graceMs = graceMsFromHours(env.BILLING_GRACE_HOURS);
      const pick = pickGrantingSubscription(snapshot.subscriptions, now, graceMs);
      const byProduct = pickGrantingByProduct(snapshot.subscriptions, now, graceMs);
      const productAware = Boolean(tenant.hasProductRows) || [...byProduct.byProduct.keys()].some((p) => p !== 'AFFILIATES');
      if (productAware) cutPick = byProduct;
      if (pick.grants) {
        kept = true;
        unblock();
        if (pick.sub) data.subscriptionExpiresAt = pick.sub.expiresAt === null ? null : new Date(pick.sub.expiresAt);
        syncSlug = pick.planSlug;
        if (productAware) {
          // PROD-15: Afiliados só fica inativo se outro produto dá acesso e nada de Afiliados/desconhecido dá
          if (pick.planSlug && pick.sub) affiliatesWrite = tenant.hasAffiliatesRow ? { active: true } : null;
          else if (!byProduct.legacyGrants) affiliatesWrite = { active: false };
        }
      } else {
        blocked = true;
        block(type === 'subscription.payment_failed' ? 'SUSPENDED' : 'CANCELLED');
      }
    }
    // Vencimento só muda em ativação/renovação/atualização; demais eventos mantêm (produto novo grava na linha dele)
    const expiresAt = input.payload.expiresAt;
    let productExpiresAt: Date | null | undefined;
    if (PLAN_SYNC.has(type) && expiresAt !== undefined) {
      // A rota já recusa malformado; aqui, por defesa, malformado mantém o gravado (nunca vira "sem vencimento")
      const parsed = parseExpiresAt(expiresAt);
      if (!parsed.valid) log.warn({ eventId: input.eventId }, 'Malformed expiresAt ignored');
      else if (newPlan) productExpiresAt = parsed.value;
      else data.subscriptionExpiresAt = parsed.value;
    }
    if (syncSlug) data.planSlug = syncSlug;

    if (Object.keys(data).length > 0) {
      await tx.tenant.update({ where: { id: tenant.id }, data });
    }

    // Entitlements + rodízio (LROT-14) + Página de Ofertas (STORE-02) no mesmo commit
    if (syncSlug) await syncPlanEntitlements(tx, tenant.id, syncSlug);

    const productsTouched = await this.applyProducts(tx, tenant.id, {
      newPlan: newPlan && PLAN_SYNC.has(type) ? newPlan : null,
      productExpiresAt,
      affiliatesWrite,
      affiliatesPlanSlug: syncSlug,
      cutPick,
      blocked,
    });
    // PROD-18: chaves compartilhadas pela união dos produtos ativos (só tenant multi-produto)
    if (!blocked && (productsTouched || newPlan || tenant.hasProductRows)) await writeMergedSharedEntitlements(tx, tenant.id);

    await advanceWatermark();
    const outcome: BillingOutcome = kept ? 'KEPT_ACTIVE' : 'APPLIED';
    await receipt(outcome);
    return { outcome, tenantId: tenant.id, suspended, productsTouched };
  }

  /** Linhas de `tenant_products` do evento. Devolve se alguma linha foi gravada. */
  private async applyProducts(
    tx: TxClient,
    tenantId: string,
    p: {
      newPlan: ResolvedPlan | null;
      productExpiresAt: Date | null | undefined;
      affiliatesWrite: { active: boolean } | null;
      affiliatesPlanSlug: string | null;
      cutPick: ProductGrantingPick | null;
      blocked: boolean;
    },
  ): Promise<boolean> {
    let touched = false;
    if (p.newPlan) {
      touched = await writeBillingProductRow(tx, tenantId, { product: p.newPlan.product, active: true, planSlug: p.newPlan.planSlug, expiresAt: p.productExpiresAt });
      await syncProductPlanEntitlements(tx, tenantId, p.newPlan.planSlug);
    }
    if (p.cutPick) {
      // Produto novo: com acesso sincroniza; sem acesso (ou corte total) linha existente vira inativa
      const existing = await createTenantProductRepository(tx).findAll(tenantId);
      const keys = new Set<ProductKey>([...p.cutPick.byProduct.keys(), ...existing.map((r) => r.product)]);
      for (const product of keys) {
        if (isLegacyProduct(product)) continue;
        const g = p.cutPick.byProduct.get(product);
        if (!p.blocked && g?.grants && g.planSlug && g.sub) {
          const expiresAt = g.sub.expiresAt === null ? null : new Date(g.sub.expiresAt);
          touched = (await writeBillingProductRow(tx, tenantId, { product, active: true, planSlug: g.planSlug, expiresAt })) || touched;
          await syncProductPlanEntitlements(tx, tenantId, g.planSlug);
        } else {
          touched = (await writeBillingProductRow(tx, tenantId, { product, active: false, planSlug: null }, { onlyIfExists: true })) || touched;
        }
      }
    }
    if (p.affiliatesWrite) {
      const { active } = p.affiliatesWrite;
      // Ativo: só atualiza linha existente (sem linha = ativo); inativo: cria (PROD-14/15)
      touched = (await writeBillingProductRow(
        tx, tenantId,
        { product: 'AFFILIATES', active, planSlug: active ? p.affiliatesPlanSlug : null },
        { onlyIfExists: active },
      )) || touched;
    }
    return touched;
  }
}
