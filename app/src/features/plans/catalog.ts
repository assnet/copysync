/**
 * Catálogo de vitrine dos planos (fonte: `docs/produto-roadmap.md`, tabela de planos).
 *
 * Preço aqui é **texto de marketing** ("de/por"), nunca regra: o sistema guarda só `planSlug` e
 * entitlements (`docs/arquitetura-central-billing.md`). Quando o catálogo passar a vir da central,
 * este arquivo fica só com o texto de vitrine. Nenhum cálculo de desconto ou cupom aqui.
 */

import { linkRotationLimitLabel } from './strings';

export type PlanSlug = 'starter' | 'profissional' | 'business';
export type BillingPeriod = 'monthly' | 'annual';

/** Desconto do anual, exibido no toggle. Valor anual por plano ainda não definido: segue o modelo do Pulso (−20%). */
export const ANNUAL_DISCOUNT = 0.2;

export interface PlanBenefit {
  label: string;
  /** Linha de destaque (ex.: "Tudo do Starter"). */
  strong?: boolean;
  /** Explicação curta no Tooltip; só em termo que precisa de contexto. */
  hint?: string;
  /** Exclusivo deste plano (chip ao lado do texto). */
  exclusive?: boolean;
}

export interface PlanCatalogItem {
  slug: PlanSlug;
  name: string;
  tagline: string;
  /** Preço "de" riscado (R$). */
  priceFrom: number;
  /** Preço "por" no mensal (R$/mês). */
  price: number;
  /** Preço mensal-equivalente no anual (R$/mês, cobrado por ano). ≈ `price × (1 − ANNUAL_DISCOUNT)`, arredondado. */
  priceAnnualMonthly: number;
  recommended?: boolean;
  /** Limites numéricos exibidos; devem bater com `PlanEntitlementPreset` da API. */
  limits: {
    whatsappSessions: number;
    telegramSessions: number;
    monitoredGroups: number;
    broadcastGroups: number;
    /** Links públicos de rodízio (`link_rotations`). */
    linkRotations: number;
    /** Grupos por link de rodízio (`link_rotation_groups`). */
    linkRotationGroups: number;
  };
  benefits: PlanBenefit[];
  fit: string;
}

/** Benefício da Página de Ofertas (`storefront_enabled`: só Profissional e Business). */
export const STOREFRONT_BENEFIT_LABEL = 'Página de Ofertas para a bio';

const HINTS = {
  monitoredGroups: 'Grupos de onde as ofertas são capturadas: cada anúncio novo é lido, reescrito e ganha o seu link.',
  broadcastGroups: 'Grupos que recebem os disparos, na ordem e nos horários que você definir.',
  linkRotation: 'Um link fixo para divulgar nas redes. Nunca expira e leva cada visitante a um grupo com vaga.',
  mentionAll: 'Marca todos os participantes do grupo no disparo para aumentar a visualização.',
  storefront: 'Uma página com suas ofertas e links de afiliado para colocar na bio das redes sociais.',
  typing: 'Antes de cada oferta o grupo vê "digitando…", como se fosse uma pessoa enviando.',
  crossSession: 'Monitore grupos em um WhatsApp e dispare nos grupos de outro WhatsApp conectado na mesma conta.',
};

export const PLAN_CATALOG: readonly PlanCatalogItem[] = [
  {
    slug: 'starter',
    name: 'Starter',
    tagline: 'Para começar a monetizar seus grupos',
    priceFrom: 161.9,
    price: 97,
    priceAnnualMonthly: 77,
    limits: { whatsappSessions: 1, telegramSessions: 0, monitoredGroups: 1, broadcastGroups: 5, linkRotations: 1, linkRotationGroups: 3 },
    benefits: [
      { label: '1 conexão de WhatsApp' },
      { label: '1 grupo monitorado', hint: HINTS.monitoredGroups },
      { label: '5 grupos de disparo', hint: HINTS.broadcastGroups },
      { label: 'Disparo em massa com agendamento de horários' },
      { label: linkRotationLimitLabel(1, 3), hint: HINTS.linkRotation },
      { label: 'Gerador de ofertas' },
      { label: 'Envio "digitando…" antes de cada oferta', hint: HINTS.typing },
      { label: 'Shopee, Amazon e Mercado Livre' },
      { label: 'Suporte 24/7 e aulas em vídeo' },
    ],
    fit: 'quem está começando ou mantém uma operação enxuta.',
  },
  {
    slug: 'profissional',
    name: 'Profissional',
    tagline: 'Para quem já vive de afiliado',
    priceFrom: 278.9,
    price: 167,
    priceAnnualMonthly: 133,
    recommended: true,
    limits: { whatsappSessions: 1, telegramSessions: 1, monitoredGroups: 2, broadcastGroups: 10, linkRotations: 1, linkRotationGroups: 5 },
    benefits: [
      { label: 'Tudo do Starter', strong: true },
      { label: '1 WhatsApp + 1 Telegram' },
      { label: '2 grupos monitorados por canal', hint: HINTS.monitoredGroups },
      { label: '10 grupos de disparo por canal', hint: HINTS.broadcastGroups },
      { label: linkRotationLimitLabel(1, 5), hint: HINTS.linkRotation },
      { label: 'Menção a todos os participantes', hint: HINTS.mentionAll },
      { label: STOREFRONT_BENEFIT_LABEL, hint: HINTS.storefront },
      { label: 'Suporte prioritário 24/7' },
    ],
    fit: 'quem posta todo dia e quer escalar sem contratar.',
  },
  {
    slug: 'business',
    name: 'Business',
    tagline: 'Para operações com vários canais',
    priceFrom: 411.9,
    price: 247,
    priceAnnualMonthly: 197,
    limits: { whatsappSessions: 2, telegramSessions: 2, monitoredGroups: 6, broadcastGroups: 40, linkRotations: 2, linkRotationGroups: 10 },
    benefits: [
      { label: 'Tudo do Profissional', strong: true },
      { label: '2 WhatsApp + 2 Telegram' },
      { label: '6 grupos monitorados por canal', hint: HINTS.monitoredGroups },
      { label: '40 grupos de disparo por canal', hint: HINTS.broadcastGroups },
      { label: linkRotationLimitLabel(2, 10), hint: HINTS.linkRotation },
      { label: 'Monitorar em um WhatsApp e disparar em outro', hint: HINTS.crossSession, exclusive: true },
      { label: STOREFRONT_BENEFIT_LABEL, hint: HINTS.storefront },
      { label: 'Template para Instagram', exclusive: true },
      { label: 'Suporte exclusivo 24/7' },
    ],
    fit: 'equipes e operações com mais de um número ou nicho.',
  },
];

/**
 * Nome especial (premium) da Página de Ofertas: compra avulsa, fora dos planos. Só texto de vitrine
 * (placeholder); sem `checkoutUrl` o painel mostra "Em breve" desabilitado.
 */
export const PREMIUM_SLUG_OFFER: {
  title: string;
  benefits: string[];
  priceLabel: string;
  checkoutUrl: string | null;
} = {
  title: 'Garanta um nome especial',
  benefits: [
    'Endereço curto e fácil de lembrar',
    'Mais confiança para quem visita a sua página',
    'Nome exclusivo: ninguém mais usa enquanto for seu',
  ],
  priceLabel: 'Preço em breve',
  checkoutUrl: null,
};

/** Preço exibido (R$/mês) no período escolhido. */
export function priceFor(plan: PlanCatalogItem, period: BillingPeriod): number {
  return period === 'annual' ? plan.priceAnnualMonthly : plan.price;
}

/** Economia exibida no chip: no mensal, contra o preço "de"; no anual, o que se deixa de pagar em 12 meses contra o mensal. */
export function savingsFor(plan: PlanCatalogItem, period: BillingPeriod): { value: number; per: 'month' | 'year' } {
  return period === 'annual'
    ? { value: (plan.price - plan.priceAnnualMonthly) * 12, per: 'year' }
    : { value: plan.priceFrom - plan.price, per: 'month' };
}
