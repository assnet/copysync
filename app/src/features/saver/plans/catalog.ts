/**
 * Vitrine de planos do Saver (fonte: `.specs/features/saver/design.md` §2.1 e `docs/produto-roadmap.md`).
 * Preço é texto de marketing, nunca regra nem banco: o sistema guarda só `planSlug` e entitlements.
 * Limites espelham `SAVER_PLAN_PRESETS` da API (`api/src/modules/tenants/domain/planPresets.ts`);
 * o teste ao lado trava os dois.
 */
import { REDIRECT_PUBLIC_PATH } from '@/features/redirectLinks/strings';

export type SaverPlanTier = 'lite' | 'pro' | 'max';
export type SaverBillingPeriod = 'monthly' | 'annual';

export interface SaverPlanCatalogItem {
  tier: SaverPlanTier;
  /** Slug interno da API (`SAVER_PRO`…), para destacar o plano atual. */
  planSlug: 'SAVER_LITE' | 'SAVER_PRO' | 'SAVER_MAX';
  name: string;
  tagline: string;
  /** R$/mês no mensal. */
  price: number;
  /** R$/mês no anual (cobrado de uma vez por ano). */
  priceAnnualMonthly: number;
  recommended?: boolean;
  limits: {
    /** `null` = ilimitado. */
    groups: number | null;
    /** Contatos distintos guardados; `null` = ilimitado. */
    contacts: number | null;
    /** Leituras de grupo em 24 h (proteção do número, não limite comercial). */
    groupScansPerDay: number;
    whatsappSessions: number;
    autoRefresh: boolean;
  };
  fit: string;
}

export const SAVER_PLAN_CATALOG: readonly SaverPlanCatalogItem[] = [
  {
    tier: 'lite',
    planSlug: 'SAVER_LITE',
    name: 'LITE',
    tagline: 'Para salvar os contatos dos seus primeiros grupos',
    price: 29.9,
    priceAnnualMonthly: 23.9,
    limits: { groups: 10, contacts: 10_000, groupScansPerDay: 20, whatsappSessions: 1, autoRefresh: false },
    fit: 'quem tem poucos grupos e quer a lista em mãos.',
  },
  {
    tier: 'pro',
    planSlug: 'SAVER_PRO',
    name: 'PRO',
    tagline: 'Para quem cuida de vários grupos todo dia',
    price: 39.9,
    priceAnnualMonthly: 32.9,
    recommended: true,
    limits: { groups: 50, contacts: 50_000, groupScansPerDay: 100, whatsappSessions: 1, autoRefresh: true },
    fit: 'quem precisa da lista sempre atualizada.',
  },
  {
    tier: 'max',
    planSlug: 'SAVER_MAX',
    name: 'MAX',
    tagline: 'Para operações com muitos grupos e dois números',
    price: 49.9,
    priceAnnualMonthly: 39.9,
    limits: { groups: null, contacts: null, groupScansPerDay: 500, whatsappSessions: 2, autoRefresh: true },
    fit: 'quem não quer pensar em limite de grupos ou de contatos.',
  },
];

/** R$/mês exibido no período. */
/**
 * Link de compra do plano×período: link de redirecionamento da plataforma (`/redirect/saver-<tier>-<mensal|anual>`,
 * migration `add_saver_checkout_redirect_links`). O super admin troca o destino em Plataforma → Links de
 * redirecionamento sem deploy (docs/redirect-links.md).
 */
export function saverCheckoutPath(tier: SaverPlanTier, period: SaverBillingPeriod): string {
  return `${REDIRECT_PUBLIC_PATH}/saver-${tier}-${period === 'annual' ? 'anual' : 'mensal'}`;
}

export function saverPriceFor(plan: SaverPlanCatalogItem, period: SaverBillingPeriod): number {
  return period === 'annual' ? plan.priceAnnualMonthly : plan.price;
}

/** Total cobrado no anual (R$), sem erro de ponto flutuante. */
export function saverAnnualTotal(plan: SaverPlanCatalogItem): number {
  return Math.round(plan.priceAnnualMonthly * 12 * 100) / 100;
}

export function saverPlanBySlug(planSlug: string | null | undefined): SaverPlanCatalogItem | undefined {
  return SAVER_PLAN_CATALOG.find((p) => p.planSlug === planSlug);
}
