/**
 * Catálogo de vitrine dos planos (fonte: `docs/produto-roadmap.md`, tabela de planos).
 *
 * Preço aqui é **texto de marketing** ("de/por"), nunca regra: o sistema guarda só `planSlug` e
 * entitlements (`docs/arquitetura-central-billing.md`). Quando o catálogo passar a vir da central,
 * este arquivo fica só com o texto de vitrine. Nenhum cálculo de desconto ou cupom aqui.
 */

export type PlanSlug = 'starter' | 'profissional' | 'business';

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
  /** Preço "por" (R$/mês). */
  price: number;
  recommended?: boolean;
  /** Limites numéricos exibidos; devem bater com `PlanEntitlementPreset` da API. */
  limits: { whatsappSessions: number; telegramSessions: number; monitoredGroups: number; broadcastGroups: number };
  benefits: PlanBenefit[];
  fit: string;
}

const HINTS = {
  monitoredGroups: 'Grupos de onde as ofertas são capturadas: cada anúncio novo é lido, reescrito e ganha o seu link.',
  broadcastGroups: 'Grupos que recebem os disparos, na ordem e nos horários que você definir.',
  linkRotation: 'Cada envio sai com o seu link de afiliado refeito, alternando entre as credenciais cadastradas.',
  mentionAll: 'Marca todos os participantes do grupo no disparo para aumentar a visualização.',
  customDomain: 'Sua página de ofertas no seu próprio domínio, em vez do endereço padrão.',
};

export const PLAN_CATALOG: readonly PlanCatalogItem[] = [
  {
    slug: 'starter',
    name: 'Starter',
    tagline: 'Para começar a monetizar seus grupos',
    priceFrom: 161.9,
    price: 97,
    limits: { whatsappSessions: 1, telegramSessions: 0, monitoredGroups: 1, broadcastGroups: 5 },
    benefits: [
      { label: '1 conexão de WhatsApp' },
      { label: '1 grupo monitorado', hint: HINTS.monitoredGroups },
      { label: '5 grupos de disparo', hint: HINTS.broadcastGroups },
      { label: 'Disparo em massa com agendamento de horários' },
      { label: 'Rodízio de links inteligentes', hint: HINTS.linkRotation },
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
    recommended: true,
    limits: { whatsappSessions: 1, telegramSessions: 1, monitoredGroups: 2, broadcastGroups: 10 },
    benefits: [
      { label: 'Tudo do Starter', strong: true },
      { label: '1 WhatsApp + 1 Telegram' },
      { label: '2 grupos monitorados por canal', hint: HINTS.monitoredGroups },
      { label: '10 grupos de disparo por canal', hint: HINTS.broadcastGroups },
      { label: 'Menção a todos os participantes', hint: HINTS.mentionAll },
      { label: 'Gerador de ofertas automático' },
      { label: 'Página de ofertas para a bio com domínio personalizado', hint: HINTS.customDomain },
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
    limits: { whatsappSessions: 2, telegramSessions: 2, monitoredGroups: 6, broadcastGroups: 40 },
    benefits: [
      { label: 'Tudo do Profissional', strong: true },
      { label: '2 WhatsApp + 2 Telegram' },
      { label: '6 grupos monitorados por canal', hint: HINTS.monitoredGroups },
      { label: '40 grupos de disparo por canal', hint: HINTS.broadcastGroups },
      { label: 'Template para Instagram', exclusive: true },
      { label: 'Suporte exclusivo 24/7' },
    ],
    fit: 'equipes e operações com mais de um número ou nicho.',
  },
];
