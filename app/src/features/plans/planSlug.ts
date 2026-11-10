import type { PlanSlug } from './catalog';

/**
 * Slug do domínio (API: `COPYSYNC_LITE`…) → id curto do painel (`lite`…). Algumas respostas
 * (ex.: `marketplaceAvailability.*.plans`) mandam o slug do domínio cru; `GET /subscription` já
 * manda o curto. Aceita os dois; valor desconhecido vira `null`.
 */
const DOMAIN_TO_PANEL: Record<string, PlanSlug> = {
  COPYSYNC_LITE: 'lite',
  COPYSYNC_PRO: 'pro',
  COPYSYNC_MAX: 'max',
  lite: 'lite',
  pro: 'pro',
  max: 'max',
};

export function toPanelPlanSlug(slug: string): PlanSlug | null {
  // `hasOwnProperty`: `toString`/`__proto__` não podem sair do protótipo como slug.
  return Object.prototype.hasOwnProperty.call(DOMAIN_TO_PANEL, slug) ? DOMAIN_TO_PANEL[slug] : null;
}

/** Lista da API → ids curtos, sem desconhecidos nem repetidos. */
export function toPanelPlanSlugs(slugs: readonly string[]): PlanSlug[] {
  const out: PlanSlug[] = [];
  for (const s of slugs) {
    const p = toPanelPlanSlug(s);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}
