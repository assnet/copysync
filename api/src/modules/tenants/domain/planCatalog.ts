import type { ProductKey } from './services/resolveProductAccess';
import { PLAN_SLUGS, SAVER_PLAN_SLUGS, resolveEffectivePlanSlug } from './planPresets';

/**
 * Catálogo de planos por produto (ver `docs/acesso-por-produto.md`). Função pura, sem banco.
 *
 * - Afiliados: `resolveEffectivePlanSlug` inalterada (permissão `COPYSYNC_*` vence o slug).
 * - Produto novo: permissão própria (`SAVER_{TIER}`, a mais alta vence) ou, sem ela, o slug da oferta
 *   (`copysync-saver-{tier}-{mensal|anual}`) ou o interno (`SAVER_{TIER}`). Período não muda limites.
 * Afiliados é testado primeiro: todo evento de hoje resolve exatamente como antes.
 */

/** Todos os planos conhecidos (Afiliados ∪ produtos novos). É o que o admin de presets valida. */
export const ALL_PLAN_SLUGS = [...PLAN_SLUGS, ...SAVER_PLAN_SLUGS] as const;
export type AnyPlanSlug = (typeof ALL_PLAN_SLUGS)[number];

export interface ResolvedPlan {
  product: ProductKey;
  planSlug: AnyPlanSlug;
}

interface ProductPlanFamily {
  product: ProductKey;
  /** Ordem crescente de tier; slug interno = permissão. */
  slugs: readonly AnyPlanSlug[];
  /** Grupo 1 = tier em minúsculas (`lite` → `<PREFIXO>_LITE`). */
  offer: RegExp;
}

/** Famílias de produto novo. Produto novo entra aqui, nunca em `PLAN_SLUGS`. */
const NEW_PRODUCT_FAMILIES: readonly ProductPlanFamily[] = [
  { product: 'SAVER', slugs: SAVER_PLAN_SLUGS, offer: /^copysync-saver-(lite|pro|max)-(mensal|anual)$/ },
];

function resolveFamily(family: ProductPlanFamily, planSlug: string | null | undefined, permissions: readonly string[] | null | undefined): AnyPlanSlug | null {
  let best = -1;
  for (const raw of permissions ?? []) {
    if (typeof raw !== 'string') continue;
    best = Math.max(best, family.slugs.indexOf(raw.trim() as AnyPlanSlug));
  }
  if (best >= 0) return family.slugs[best];
  if (!planSlug) return null;
  const value = planSlug.trim();
  if (family.slugs.includes(value as AnyPlanSlug)) return value as AnyPlanSlug;
  const match = family.offer.exec(value.toLowerCase());
  if (!match) return null;
  return family.slugs.find((s) => s.endsWith(`_${match[1].toUpperCase()}`)) ?? null;
}

/** `planSlug` + `permissions` da central → produto e plano interno. Desconhecido = `null`. */
export function resolvePlan(planSlug: string | null | undefined, permissions: readonly string[] | null | undefined): ResolvedPlan | null {
  const affiliates = resolveEffectivePlanSlug(planSlug, permissions);
  if (affiliates) return { product: 'AFFILIATES', planSlug: affiliates };
  for (const family of NEW_PRODUCT_FAMILIES) {
    const slug = resolveFamily(family, planSlug, permissions);
    if (slug) return { product: family.product, planSlug: slug };
  }
  return null;
}

export function isKnownPlanSlug(value: string): value is AnyPlanSlug {
  return (ALL_PLAN_SLUGS as readonly string[]).includes(value);
}

/** Produto dono de um plano interno (`COPYSYNC_*` → `AFFILIATES`). Desconhecido = `null`. */
export function productOfPlanSlug(planSlug: string): ProductKey | null {
  if ((PLAN_SLUGS as readonly string[]).includes(planSlug)) return 'AFFILIATES';
  return NEW_PRODUCT_FAMILIES.find((f) => f.slugs.includes(planSlug as AnyPlanSlug))?.product ?? null;
}
