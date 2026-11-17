import { PLAN_SLUGS, resolveEffectivePlanSlug, type PlanSlug } from '../../../tenants/domain/planPresets';
import { ALL_PLAN_SLUGS, resolvePlan, type AnyPlanSlug } from '../../../tenants/domain/planCatalog';
import type { ProductKey } from '../../../tenants/domain/services/resolveProductAccess';

/**
 * Regras puras da reconciliação de assinaturas com a central (sem banco, sem HTTP).
 * Ver docs/arquitetura-central-billing.md, seção "Reconciliação".
 */

/** Item de `GET /integrations/subscriptions` da central (campos que a reconciliação usa). */
export interface HubSubscription {
  id: string;
  planSlug: string | null;
  /**
   * Permissões efetivas da assinatura (`snapshotPermissions` na central). A `COPYSYNC_*` mais alta
   * define o nível; ausente (central antiga) ou sem nenhuma reconhecida = nível pelo `planSlug`.
   */
  permissions?: string[];
  billingStatus: string | null;
  /** ISO; null = sem vencimento. */
  expiresAt: string | null;
  deletedAt: string | null;
  /** Ainda não expostos pela central; quando vierem preenchidos, cortam na hora. */
  canceledAt?: string | null;
  refundedAt?: string | null;
  chargedbackAt?: string | null;
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
  /** `Tenant.adminBlockedAt` preenchido: bloqueio do super-admin; a reconciliação nunca muda o status. */
  adminBlocked: boolean;
  subscriptionExpiresAt: Date | null;
  /**
   * Linhas de `tenant_products` (chave = produto). Ausente = estado local desconhecido: havendo assinatura
   * de produto novo, a decisão leva `products_changed` (o repositório grava de forma idempotente).
   */
  products?: ReadonlyMap<ProductKey, LocalProductState>;
}

export interface LocalProductState {
  active: boolean;
  planSlug: string | null;
  expiresAt: Date | null;
}

/** Estado esperado de um produto pela central (só quando há assinatura de produto novo). */
export interface ProductReconcileEntry {
  product: ProductKey;
  active: boolean;
  /** null = ativo sem plano conhecido (plano desconhecido conta a favor de Afiliados) ou inativo. */
  planSlug: AnyPlanSlug | null;
  subscriptionId: string | null;
  expiresAt: Date | null;
}

export type ReconcileReason =
  | 'no_plan' | 'plan_changed' | 'expiry_changed' | 'billing_suspended' | 'billing_cancelled' | 'watermark_behind' | 'products_changed';

export type ReconcileDecision =
  | {
      kind: 'apply';
      reasons: ReconcileReason[];
      planSlug: PlanSlug;
      subscriptionId: string;
      expiresAt: Date | null;
      /** SUSPENDED/CANCELLED (por cobrança) → ACTIVE. */
      activate: boolean;
      /** Novo watermark (só sobe); null = central sem evento, mantém. */
      advanceTo: bigint | null;
      /** Só quando há assinatura de produto novo. */
      products?: ProductReconcileEntry[];
    }
  /**
   * Há assinatura de produto novo e nenhum plano de Afiliados conhecido dá acesso: só linhas de produto,
   * status (`activate`) e watermark; nunca `Tenant.planSlug` nem entitlements de Afiliados.
   */
  | {
      kind: 'products';
      reasons: ReconcileReason[];
      products: ProductReconcileEntry[];
      activate: boolean;
      advanceTo: bigint | null;
    }
  /** Central tem assinaturas e nenhuma dá acesso agora; tenant ACTIVE → SUSPENDED (mesmo efeito do `payment_failed`). */
  | { kind: 'suspend'; advanceTo: bigint | null; products?: ProductReconcileEntry[] }
  | { kind: 'noop' }
  /** Central sem nenhuma assinatura do cliente (cliente desconhecido) e tenant ACTIVE: não suspende. */
  | { kind: 'unknown_customer' }
  /** Assinatura com acesso, mas nenhum `planSlug` conhecido pelo CopySync. */
  | { kind: 'unknown_plan' }
  | { kind: 'admin_suspended' }
  /** Watermark local à frente do `lastSeq` da resposta: evento mais novo já aplicado, resposta velha. */
  | { kind: 'stale' };

/** Tolerância padrão após o `expiresAt` para o banco retentar a cobrança (`BILLING_GRACE_HOURS`). */
export const DEFAULT_BILLING_GRACE_HOURS = 24;
const HOUR_MS = 3_600_000;
export const graceMsFromHours = (hours: number) => hours * HOUR_MS;

/** Dão acesso até `expiresAt` + tolerância (sem vencimento = acesso; null = legado, anterior ao campo). */
/** PENDING_CANCELLATION = pedido aguardando aprovação; na central a assinatura segue ativa até o admin aprovar. */
const OPEN_BILLING_STATUSES = new Set(['ACTIVE', 'TRIAL_ACTIVE', 'PENDING_CANCELLATION']);
/** Cobrança falhou ou o cron da central marcou vencida: acesso só até `expiresAt` + tolerância (vencimento obrigatório). */
const GRACE_ONLY_BILLING_STATUSES = new Set(['PAYMENT_FAILED', 'EXPIRED']);

/**
 * Assinatura dá acesso agora (decisões do dono, 2026-11-07):
 * - corta na hora, sem tolerância: `deletedAt`, `canceledAt`, `refundedAt` ou `chargedbackAt` preenchidos, ou
 *   `billingStatus` CANCELED (cancelamento de admin/suporte na central) ou REFUNDED (reembolso/chargeback);
 * - null | ACTIVE | TRIAL_ACTIVE | PENDING_CANCELLATION (pedido aguardando aprovação): sem vencimento ou `expiresAt` + tolerância >= agora;
 * - PAYMENT_FAILED | EXPIRED: `expiresAt` + tolerância >= agora (sem vencimento = sem acesso);
 * - qualquer outro (TRIAL_ENDED_PENDING, desconhecido): sem acesso.
 * Cancelar só a recorrência na Cakto não grava nada na central: segue ACTIVE até o vencimento + tolerância.
 */
export function subscriptionGrantsAccess(sub: HubSubscription, now: Date, graceMs: number): boolean {
  if (sub.deletedAt || sub.canceledAt || sub.refundedAt || sub.chargedbackAt) return false;
  const open = sub.billingStatus === null || OPEN_BILLING_STATUSES.has(sub.billingStatus);
  if (!open && !GRACE_ONLY_BILLING_STATUSES.has(sub.billingStatus!)) return false;
  if (sub.expiresAt === null) return open;
  const exp = Date.parse(sub.expiresAt);
  return Number.isFinite(exp) && exp + graceMs >= now.getTime();
}

/**
 * Permissões recebidas que não são nível de nenhum produto conhecido (`ALL_PLAN_SLUGS`: Afiliados e
 * produtos novos, como `SAVER_*`). Só para log; nunca derrubam o evento.
 */
export function unknownPlanPermissions(permissions: readonly string[] | null | undefined): string[] {
  return (permissions ?? []).filter((p) => !(ALL_PLAN_SLUGS as readonly string[]).includes(p.trim()));
}

const TIER = new Map<string, number>(PLAN_SLUGS.map((slug, i) => [slug, i]));
const expiryRank = (iso: string | null) => (iso === null ? Number.POSITIVE_INFINITY : Date.parse(iso));

/**
 * Assinatura que define o plano esperado: entre as que dão acesso e têm nível conhecido (permissão
 * `COPYSYNC_*` mais alta ou, sem ela, o `planSlug`), o maior
 * plano; empate = vencimento mais distante (sem vencimento primeiro), depois o menor id (estável).
 * `grants=false` = nenhuma dá acesso; `planSlug=null` = dão acesso, mas sem plano conhecido.
 */
export function pickGrantingSubscription(
  subs: readonly HubSubscription[],
  now: Date,
  graceMs: number,
): { grants: boolean; sub: HubSubscription | null; planSlug: PlanSlug | null } {
  const granting = subs.filter((s) => subscriptionGrantsAccess(s, now, graceMs));
  const known = granting
    // Mesma regra do evento (`resolveEffectivePlanSlug`): evento e reconciliação chegam ao mesmo nível
    .map((s) => ({ s, slug: resolveEffectivePlanSlug(s.planSlug, s.permissions) }))
    .filter((x): x is { s: HubSubscription; slug: PlanSlug } => x.slug !== null)
    .sort((a, b) =>
      (TIER.get(b.slug)! - TIER.get(a.slug)!)
      || (expiryRank(b.s.expiresAt) - expiryRank(a.s.expiresAt))
      || (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0));
  const best = known[0];
  return { grants: granting.length > 0, sub: best?.s ?? null, planSlug: best?.slug ?? null };
}

export interface ProductGrant {
  grants: boolean;
  sub: HubSubscription | null;
  planSlug: AnyPlanSlug | null;
}

export interface ProductGrantingPick {
  /** Produtos com ao menos uma assinatura classificada (com ou sem acesso). */
  byProduct: Map<ProductKey, ProductGrant>;
  /** Alguma assinatura de plano desconhecido dá acesso. */
  unknownGrants: boolean;
  /** Alguma assinatura dá acesso (inclui plano desconhecido, como hoje). */
  anyGrants: boolean;
  /** Afiliados com acesso: plano de Afiliados ou plano desconhecido (é assim que o tenant é mantido hoje). */
  legacyGrants: boolean;
  /** Há assinatura de Afiliados ou de plano desconhecido (com ou sem acesso). */
  hasLegacy: boolean;
}

const ALL_TIER = new Map<string, number>(ALL_PLAN_SLUGS.map((slug, i) => [slug, i]));

/** Negativo = `a` vem antes: maior plano, vencimento mais distante, menor id. */
function compareGranting(a: HubSubscription, aPlan: AnyPlanSlug, b: HubSubscription, bPlan: AnyPlanSlug): number {
  return (ALL_TIER.get(bPlan)! - ALL_TIER.get(aPlan)!)
    || (expiryRank(b.expiresAt) - expiryRank(a.expiresAt))
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Por produto, a assinatura que define o plano (mesma ordem de `pickGrantingSubscription`: maior plano,
 * vencimento mais distante, menor id). Classifica por `resolvePlan(planSlug, permissions)`.
 */
export function pickGrantingByProduct(subs: readonly HubSubscription[], now: Date, graceMs: number): ProductGrantingPick {
  const byProduct = new Map<ProductKey, ProductGrant>();
  let unknownGrants = false;
  let anyGrants = false;
  let hasLegacy = false;
  for (const s of subs) {
    const grants = subscriptionGrantsAccess(s, now, graceMs);
    anyGrants ||= grants;
    const plan = resolvePlan(s.planSlug, s.permissions);
    if (!plan) {
      hasLegacy = true;
      unknownGrants ||= grants;
      continue;
    }
    if (plan.product === 'AFFILIATES') hasLegacy = true;
    const cur = byProduct.get(plan.product);
    if (!cur) {
      byProduct.set(plan.product, grants ? { grants, sub: s, planSlug: plan.planSlug } : { grants, sub: null, planSlug: null });
      continue;
    }
    if (grants && (!cur.grants || compareGranting(s, plan.planSlug, cur.sub!, cur.planSlug!) < 0)) {
      byProduct.set(plan.product, { grants: true, sub: s, planSlug: plan.planSlug });
    }
  }
  const legacyGrants = (byProduct.get('AFFILIATES')?.grants ?? false) || unknownGrants;
  return { byProduct, unknownGrants, anyGrants, legacyGrants, hasLegacy };
}

/** Entradas por produto: Afiliados só se há assinatura dele ou de plano desconhecido; produto novo sempre. */
function productEntries(pick: ProductGrantingPick): ProductReconcileEntry[] {
  const entries: ProductReconcileEntry[] = [];
  const entry = (product: ProductKey, active: boolean, g: ProductGrant | undefined): ProductReconcileEntry => {
    const sub = active && g?.grants ? g.sub : null;
    return {
      product,
      active,
      planSlug: sub ? g!.planSlug : null,
      subscriptionId: sub?.id ?? null,
      expiresAt: sub?.expiresAt ? new Date(sub.expiresAt) : null,
    };
  };
  if (pick.hasLegacy) entries.push(entry('AFFILIATES', pick.legacyGrants, pick.byProduct.get('AFFILIATES')));
  for (const [product, g] of pick.byProduct) {
    if (product !== 'AFFILIATES') entries.push(entry(product, g.grants, g));
  }
  return entries;
}

/** Linha local diferente da esperada. Sem linha de Afiliados = ativo (legado). Estado local ausente = mudou. */
function productsChanged(local: LocalBillingState, entries: readonly ProductReconcileEntry[]): boolean {
  if (!local.products) return true;
  return entries.some((e) => {
    const row = local.products!.get(e.product);
    if (!row) return !(e.product === 'AFFILIATES' && e.active && e.planSlug === null);
    if (row.active !== e.active) return true;
    if (!e.active) return false;
    return row.planSlug !== e.planSlug || (row.expiresAt?.getTime() ?? null) !== (e.expiresAt?.getTime() ?? null);
  });
}

/**
 * Decide o que fazer com um tenant. Chamada com o estado lido sob trava, para não regredir estado
 * aplicado por evento mais novo do webhook. Suspende só quando a central lista assinaturas do cliente e
 * nenhuma dá acesso; lista vazia (cliente desconhecido na central) nunca suspende.
 */
export function decideReconcile(local: LocalBillingState, snapshot: HubSubscriptionSnapshot, now: Date, graceMs: number): ReconcileDecision {
  const { lastSeq } = snapshot;
  const localSeq = local.lastBillingEventSeq;
  if (localSeq !== null && (lastSeq === null || localSeq > lastSeq)) return { kind: 'stale' };
  const pick = pickGrantingSubscription(snapshot.subscriptions, now, graceMs);
  const byProduct = pickGrantingByProduct(snapshot.subscriptions, now, graceMs);
  const newProduct = [...byProduct.byProduct.keys()].some((p) => p !== 'AFFILIATES');
  // Sem assinatura de produto novo: decisão idêntica à de antes (`products` nunca aparece)
  const products = newProduct ? productEntries(byProduct) : undefined;
  if (!pick.grants) {
    if (local.adminBlocked) return { kind: 'admin_suspended' };
    if (local.status !== 'ACTIVE') return { kind: 'noop' };
    if (snapshot.subscriptions.length === 0) return { kind: 'unknown_customer' };
    return products ? { kind: 'suspend', advanceTo: lastSeq, products } : { kind: 'suspend', advanceTo: lastSeq };
  }
  if (!pick.planSlug || !pick.sub) {
    if (!products) return { kind: 'unknown_plan' };
    // Produto novo decide sozinho: Afiliados só por plano desconhecido (ativo, sem plano) ou cortado
    const newGrants = [...byProduct.byProduct].some(([p, g]) => p !== 'AFFILIATES' && g.grants);
    const reasons: ReconcileReason[] = [];
    if (productsChanged(local, products)) reasons.push('products_changed');
    // Plano desconhecido nunca reativou (`unknown_plan`); só produto novo com acesso reativa
    const activate = newGrants && local.status !== 'ACTIVE' && !local.adminBlocked;
    if (activate) reasons.push(local.status === 'SUSPENDED' ? 'billing_suspended' : 'billing_cancelled');
    if (lastSeq !== null && (localSeq === null || localSeq < lastSeq)) reasons.push('watermark_behind');
    if (reasons.length === 0) return local.adminBlocked ? { kind: 'admin_suspended' } : newGrants ? { kind: 'noop' } : { kind: 'unknown_plan' };
    return { kind: 'products', reasons, products, activate, advanceTo: lastSeq };
  }

  const reasons: ReconcileReason[] = [];
  if (local.planSlug === null) reasons.push('no_plan');
  else if (local.planSlug !== pick.planSlug) reasons.push('plan_changed');
  const expected = pick.sub.expiresAt === null ? null : new Date(pick.sub.expiresAt);
  if ((local.subscriptionExpiresAt?.getTime() ?? null) !== (expected?.getTime() ?? null)) reasons.push('expiry_changed');
  // Bloqueio do super-admin vence: só plano/vencimento/watermark, nunca o status
  const activate = local.status !== 'ACTIVE' && !local.adminBlocked;
  if (activate) reasons.push(local.status === 'SUSPENDED' ? 'billing_suspended' : 'billing_cancelled');
  if (lastSeq !== null && (localSeq === null || localSeq < lastSeq)) reasons.push('watermark_behind');
  if (products && productsChanged(local, products)) reasons.push('products_changed');
  if (reasons.length === 0) return local.adminBlocked ? { kind: 'admin_suspended' } : { kind: 'noop' };

  return {
    kind: 'apply',
    reasons,
    planSlug: pick.planSlug,
    subscriptionId: pick.sub.id,
    expiresAt: expected,
    activate,
    advanceTo: lastSeq,
    ...(products ? { products } : {}),
  };
}
