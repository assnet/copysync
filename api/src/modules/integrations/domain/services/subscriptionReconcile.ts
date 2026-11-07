import { PLAN_SLUGS, resolvePlanSlug, type PlanSlug } from '../../../tenants/domain/planPresets';

/**
 * Regras puras da reconciliação de assinaturas com a central (sem banco, sem HTTP).
 * Ver docs/arquitetura-central-billing.md, seção "Reconciliação".
 */

/** Item de `GET /integrations/subscriptions` da central (campos que a reconciliação usa). */
export interface HubSubscription {
  id: string;
  planSlug: string | null;
  billingStatus: string | null;
  /** ISO; null = sem vencimento. */
  expiresAt: string | null;
  deletedAt: string | null;
}

export interface HubSubscriptionSnapshot {
  externalUserId: string;
  subscriptions: HubSubscription[];
  /** Maior `seq` de evento do cliente na central; null = nenhum evento. */
  lastSeq: bigint | null;
}

export type LocalTenantStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';

/** Estado do tenant lido sob trava (FOR UPDATE). */
export interface LocalBillingState {
  status: LocalTenantStatus;
  planSlug: string | null;
  lastBillingEventSeq: bigint | null;
  /** SUSPENDED por ação de super-admin (não por cobrança): a reconciliação não reativa. */
  suspendedByAdmin: boolean;
}

export type ReconcileReason = 'no_plan' | 'plan_changed' | 'billing_suspended' | 'watermark_behind';

export type ReconcileDecision =
  | {
      kind: 'apply';
      reasons: ReconcileReason[];
      planSlug: PlanSlug;
      subscriptionId: string;
      expiresAt: Date | null;
      /** SUSPENDED → ACTIVE. */
      activate: boolean;
      /** Novo watermark (só sobe); null = central sem evento, mantém. */
      advanceTo: bigint | null;
    }
  /** Central tem assinaturas e nenhuma dá acesso agora; tenant ACTIVE → SUSPENDED (mesmo efeito do `payment_failed`). */
  | { kind: 'suspend'; advanceTo: bigint | null }
  | { kind: 'noop' }
  /** Central sem nenhuma assinatura do cliente (cliente desconhecido) e tenant ACTIVE: não suspende. */
  | { kind: 'unknown_customer' }
  /** Assinatura com acesso, mas nenhum `planSlug` conhecido pelo CopySync. */
  | { kind: 'unknown_plan' }
  | { kind: 'admin_suspended' }
  /** Watermark local à frente do `lastSeq` da resposta: evento mais novo já aplicado, resposta velha. */
  | { kind: 'stale' };

/** Cobrança em dia; null = legado (anterior ao campo), também dá acesso. Sem vencimento = acesso. */
const PAID_BILLING_STATUSES = new Set(['ACTIVE', 'TRIAL_ACTIVE']);
/** Só a recorrência foi cancelada: acesso até o fim do ciclo pago (`expiresAt` obrigatório). */
const CYCLE_END_BILLING_STATUSES = new Set(['CANCELED', 'PENDING_CANCELLATION']);

const notExpired = (iso: string, now: Date) => {
  const exp = Date.parse(iso);
  return Number.isFinite(exp) && exp >= now.getTime();
};

/**
 * Assinatura dá acesso agora (decisão do dono, 2026-11-07, comportamento do PulsoSocial): não excluída e
 * - `billingStatus` null | ACTIVE | TRIAL_ACTIVE: sem vencimento ou vencimento >= agora;
 * - CANCELED | PENDING_CANCELLATION (só a recorrência): até o `expiresAt`; sem vencimento = sem acesso;
 * - REFUNDED (reembolso/chargeback), PAYMENT_FAILED, EXPIRED, TRIAL_ENDED_PENDING e desconhecido: sem acesso.
 * A resposta não expõe `canceledAt`/`refundedAt`/`chargedbackAt`: estorno que a central grava como
 * CANCELED corta só no `expiresAt` (pendência na doc).
 */
export function subscriptionGrantsAccess(sub: HubSubscription, now: Date): boolean {
  if (sub.deletedAt !== null) return false;
  if (sub.billingStatus === null || PAID_BILLING_STATUSES.has(sub.billingStatus)) {
    return sub.expiresAt === null || notExpired(sub.expiresAt, now);
  }
  if (CYCLE_END_BILLING_STATUSES.has(sub.billingStatus)) return sub.expiresAt !== null && notExpired(sub.expiresAt, now);
  return false;
}

const TIER = new Map<string, number>(PLAN_SLUGS.map((slug, i) => [slug, i]));
const expiryRank = (iso: string | null) => (iso === null ? Number.POSITIVE_INFINITY : Date.parse(iso));

/**
 * Assinatura que define o plano esperado: entre as que dão acesso e têm plano conhecido, o maior
 * plano; empate = vencimento mais distante (sem vencimento primeiro), depois o menor id (estável).
 * `grants=false` = nenhuma dá acesso; `planSlug=null` = dão acesso, mas sem plano conhecido.
 */
export function pickGrantingSubscription(
  subs: readonly HubSubscription[],
  now: Date,
): { grants: boolean; sub: HubSubscription | null; planSlug: PlanSlug | null } {
  const granting = subs.filter((s) => subscriptionGrantsAccess(s, now));
  const known = granting
    .map((s) => ({ s, slug: resolvePlanSlug(s.planSlug) }))
    .filter((x): x is { s: HubSubscription; slug: PlanSlug } => x.slug !== null)
    .sort((a, b) =>
      (TIER.get(b.slug)! - TIER.get(a.slug)!)
      || (expiryRank(b.s.expiresAt) - expiryRank(a.s.expiresAt))
      || (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0));
  const best = known[0];
  return { grants: granting.length > 0, sub: best?.s ?? null, planSlug: best?.slug ?? null };
}

/**
 * Decide o que fazer com um tenant. Chamada com o estado lido sob trava, para não regredir estado
 * aplicado por evento mais novo do webhook. Suspende só quando a central lista assinaturas do cliente e
 * nenhuma dá acesso; lista vazia (cliente desconhecido na central) nunca suspende.
 */
export function decideReconcile(local: LocalBillingState, snapshot: HubSubscriptionSnapshot, now: Date): ReconcileDecision {
  const { lastSeq } = snapshot;
  const localSeq = local.lastBillingEventSeq;
  if (localSeq !== null && (lastSeq === null || localSeq > lastSeq)) return { kind: 'stale' };
  if (local.status === 'CANCELLED') return { kind: 'noop' };

  const pick = pickGrantingSubscription(snapshot.subscriptions, now);
  if (!pick.grants) {
    if (local.status !== 'ACTIVE') return { kind: 'noop' };
    return snapshot.subscriptions.length === 0 ? { kind: 'unknown_customer' } : { kind: 'suspend', advanceTo: lastSeq };
  }
  if (!pick.planSlug || !pick.sub) return { kind: 'unknown_plan' };

  const reasons: ReconcileReason[] = [];
  if (local.planSlug === null) reasons.push('no_plan');
  else if (local.planSlug !== pick.planSlug) reasons.push('plan_changed');
  if (local.status === 'SUSPENDED') {
    if (local.suspendedByAdmin) return { kind: 'admin_suspended' };
    reasons.push('billing_suspended');
  }
  if (lastSeq !== null && (localSeq === null || localSeq < lastSeq)) reasons.push('watermark_behind');
  if (reasons.length === 0) return { kind: 'noop' };

  return {
    kind: 'apply',
    reasons,
    planSlug: pick.planSlug,
    subscriptionId: pick.sub.id,
    expiresAt: pick.sub.expiresAt === null ? null : new Date(pick.sub.expiresAt),
    activate: local.status === 'SUSPENDED',
    advanceTo: lastSeq,
  };
}
