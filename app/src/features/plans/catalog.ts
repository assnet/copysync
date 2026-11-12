/**
 * Catálogo de vitrine dos planos (fonte: `docs/produto-roadmap.md`, tabela de planos).
 *
 * Preço aqui é **texto de marketing** ("de/por"), nunca regra: o sistema guarda só `planSlug` e
 * entitlements (`docs/arquitetura-central-billing.md`). Quando o catálogo passar a vir da central,
 * este arquivo fica só com o texto de vitrine. Nenhum cálculo de desconto ou cupom aqui.
 */

import { TELEGRAM_LINK_ROTATION_LABEL, linkRotationLimitLabel } from './strings';

export type PlanSlug = 'lite' | 'pro' | 'max';
export type BillingPeriod = 'monthly' | 'annual';

/** Desconto do anual, exibido no toggle. Valor anual por plano ainda não definido: segue o modelo do Pulso (−20%). */
export const ANNUAL_DISCOUNT = 0.2;

export interface PlanBenefit {
  label: string;
  /** Linha de destaque (ex.: "Tudo do LITE"). */
  strong?: boolean;
  /** Segunda linha, mais discreta (ex.: o limite "1 link · até 5 grupos"). */
  detail?: string;
  /** Explicação curta no Tooltip; só em termo que precisa de contexto. */
  hint?: string;
  /** Exclusivo deste plano (chip ao lado do texto). */
  exclusive?: boolean;
  /** Recurso de um canal: linha em destaque com o logo do canal no lugar do check. */
  channel?: 'whatsapp' | 'telegram';
  /** Recurso com nome próprio (ex.: "Cross Session"): bloco em destaque; `label` vira a descrição. */
  featureName?: string;
  /** Ícone do bloco do recurso: `sessions` = setas (Cross Session); `channels` = logos WhatsApp + Telegram. */
  featureIcon?: 'sessions' | 'channels';
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
  /** Página de pagamento do gateway por período (texto de vitrine, nunca no banco). Ver `docs/planos.md`. */
  checkoutUrls: Record<BillingPeriod, string>;
  /** Limites numéricos exibidos; devem bater com `PlanEntitlementPreset` da API. */
  limits: {
    whatsappSessions: number;
    telegramSessions: number;
    /** Grupos monitorados no WhatsApp (`monitored_groups`, chave sem prefixo = WhatsApp). */
    monitoredGroups: number;
    /** Grupos de disparo no WhatsApp (`broadcast_groups`). */
    broadcastGroups: number;
    /** Grupos monitorados no Telegram (`telegram_monitored_groups`). */
    telegramMonitoredGroups: number;
    /** Grupos de disparo no Telegram (`telegram_broadcast_groups`). */
    telegramBroadcastGroups: number;
    /** Links de rodízio no WhatsApp (`link_rotations`, chave sem prefixo = WhatsApp). */
    linkRotations: number;
    /** Grupos por link de rodízio no WhatsApp (`link_rotation_groups`). */
    linkRotationGroups: number;
    /** Links de rodízio no Telegram (`telegram_link_rotations`). */
    telegramLinkRotations: number;
    /** Grupos/canais por link de rodízio no Telegram (`telegram_link_rotation_groups`). */
    telegramLinkRotationGroups: number;
    /** Etiquetas do Mercado Livre vinculadas, principal incluída (`mercado_livre_affiliate_tags`). Fora de `benefits`. */
    mercadoLivreTags: number;
  };
  /** Itens além dos limites por canal (estes o `PlanCard` monta a partir de `limits`, inclusive o rodízio). */
  benefits: PlanBenefit[];
  fit: string;
}

/** Nome do recurso de monitorar numa sessão e disparar noutra do mesmo canal (`cross_session_dispatch`). */
export const CROSS_SESSION_NAME = 'Cross Session';

/** Nome do recurso de monitorar num canal e postar no outro (Telegram → WhatsApp e vice-versa). */
export const CROSS_CHANNEL_NAME = 'Cross Channel';

/** Benefício da Página de Ofertas (`storefront_enabled`: só PRO e MAX). */
export const STOREFRONT_BENEFIT_LABEL = 'Página de Ofertas para a bio';

/** Textos de Tooltip dos benefícios e das linhas da tabela de canais do `PlanCard`. */
export const PLAN_HINTS = {
  monitoredGroups: 'Grupos de onde as ofertas são capturadas: cada anúncio novo é lido, reescrito e ganha o seu link.',
  broadcastGroups: 'Grupos que recebem os disparos, na ordem e nos horários que você definir.',
  linkRotation: 'Um link fixo para divulgar nas redes. Nunca expira e leva cada visitante a um grupo com vaga.',
  telegramLinkRotation:
    'Um link fixo para divulgar nas redes que distribui os visitantes entre os seus grupos e canais do Telegram, sempre para um com vaga. Para gerar o convite ou colar o link, sua conta precisa ser admin do grupo ou canal.',
  mentionAll: 'Marca todos os participantes do grupo no disparo para aumentar a visualização.',
  captureOutsideWindow: 'Fora do horário de postagem o monitoramento continua capturando: as ofertas ficam na fila e saem assim que o horário abrir.',
  enrichLinkOnly: 'No monitoramento, mensagem que chega só com o link vira oferta completa, com título, preço e foto do produto.',
  aiRewrite: 'A IA reescreve o texto de cada oferta para o público escolhido, no gerador de ofertas e no monitoramento.',
  sheinAffiliate: 'Ofertas da Shein com o seu link de afiliado, no gerador e no monitoramento. Pede o aceite de um aviso de risco antes do uso.',
  offerHunter:
    'Busca ofertas da Shein no seu horário, escolhe as melhores pela pontuação (e pela IA) e envia ao seu grupo. Pede o aceite de um aviso de risco próprio.',
  storefront: 'Uma página com suas ofertas e links de afiliado para colocar na bio das redes sociais.',
  typing: 'Antes de cada oferta o grupo vê "digitando…", como se fosse uma pessoa enviando.',
  crossSession:
    'Cross Session: com duas sessões do mesmo canal (ex.: dois WhatsApp), monitore grupos em uma e dispare nos grupos da outra. Entre WhatsApp e Telegram isso já vale em todo plano que tem os dois canais.',
  crossChannel:
    'Cross Channel: capture ofertas de grupos e canais do Telegram e poste nos seus grupos de WhatsApp, ou o contrário. Um só fluxo de ofertas alimenta os dois canais.',
  bothChannels: 'Monitore grupos no WhatsApp e dispare no Telegram, ou o contrário: as ofertas circulam entre os dois canais.',
  telegramGroupsChannels:
    'Capture ofertas de grupos e canais do Telegram, inclusive canais em que você só é inscrito, e envie para os grupos e canais em que você pode postar.',
};

/** Destaque do rodízio no Telegram (PRO e MAX), com o limite do plano no texto. */
function telegramLinkRotation(links: number, groups: number): PlanBenefit {
  return { label: TELEGRAM_LINK_ROTATION_LABEL, detail: linkRotationLimitLabel(links, groups), hint: PLAN_HINTS.telegramLinkRotation, channel: 'telegram' };
}

/** Destaque do Telegram nos planos com Telegram (PRO e MAX). */
const TELEGRAM_GROUPS_CHANNELS: PlanBenefit = {
  label: 'Telegram: monitore e envie em grupos e canais',
  hint: PLAN_HINTS.telegramGroupsChannels,
  channel: 'telegram',
};

export const PLAN_CATALOG: readonly PlanCatalogItem[] = [
  {
    slug: 'lite',
    name: 'LITE',
    tagline: 'Para começar a monetizar seus grupos',
    priceFrom: 161.9,
    price: 97,
    priceAnnualMonthly: 77,
    checkoutUrls: { monthly: 'https://pay.cakto.com.br/8e4gepk_1291207', annual: 'https://pay.cakto.com.br/a92kn9k_1291217' },
    limits: {
      whatsappSessions: 1, telegramSessions: 0, monitoredGroups: 1, broadcastGroups: 5, telegramMonitoredGroups: 0, telegramBroadcastGroups: 0,
      linkRotations: 1, linkRotationGroups: 3, telegramLinkRotations: 0, telegramLinkRotationGroups: 0, mercadoLivreTags: 1,
    },
    benefits: [
      { label: 'Disparo em massa com agendamento de horários' },
      { label: 'Gerador de ofertas' },
      { label: 'Envio "digitando…" antes de cada oferta', hint: PLAN_HINTS.typing },
      { label: 'Shopee, Amazon e Mercado Livre' },
      { label: 'Suporte 24/7 e aulas em vídeo' },
    ],
    fit: 'quem está começando ou mantém uma operação enxuta.',
  },
  {
    slug: 'pro',
    name: 'PRO',
    tagline: 'Para quem já vive de afiliado',
    priceFrom: 278.9,
    price: 167,
    priceAnnualMonthly: 133,
    checkoutUrls: { monthly: 'https://pay.cakto.com.br/fronsgu_1291227', annual: 'https://pay.cakto.com.br/f34qfgh_1291232' },
    recommended: true,
    limits: {
      whatsappSessions: 1, telegramSessions: 1, monitoredGroups: 2, broadcastGroups: 10, telegramMonitoredGroups: 2, telegramBroadcastGroups: 10,
      linkRotations: 1, linkRotationGroups: 5, telegramLinkRotations: 1, telegramLinkRotationGroups: 5, mercadoLivreTags: 2,
    },
    benefits: [
      { label: 'Tudo do LITE', strong: true },
      TELEGRAM_GROUPS_CHANNELS,
      telegramLinkRotation(1, 5),
      { label: 'Ofertas circulando entre WhatsApp e Telegram', hint: PLAN_HINTS.bothChannels },
      { label: 'Menção a todos os participantes', hint: PLAN_HINTS.mentionAll },
      { label: 'Oferta montada a partir só do link', hint: PLAN_HINTS.enrichLinkOnly },
      { label: 'Reescrita com IA para o seu público', hint: PLAN_HINTS.aiRewrite },
      { label: STOREFRONT_BENEFIT_LABEL, hint: PLAN_HINTS.storefront },
      { label: 'Suporte prioritário 24/7' },
    ],
    fit: 'quem posta todo dia e quer escalar sem contratar.',
  },
  {
    slug: 'max',
    name: 'MAX',
    tagline: 'Para operações com vários canais',
    priceFrom: 411.9,
    price: 247,
    priceAnnualMonthly: 197,
    checkoutUrls: { monthly: 'https://pay.cakto.com.br/kzoagvc_1291239', annual: 'https://pay.cakto.com.br/97nqcb8_1291245' },
    limits: {
      whatsappSessions: 2, telegramSessions: 2, monitoredGroups: 6, broadcastGroups: 40, telegramMonitoredGroups: 6, telegramBroadcastGroups: 40,
      linkRotations: 2, linkRotationGroups: 10, telegramLinkRotations: 2, telegramLinkRotationGroups: 10, mercadoLivreTags: 10,
    },
    benefits: [
      { label: 'Tudo do PRO', strong: true },
      {
        featureName: CROSS_SESSION_NAME,
        label: 'Monitore em uma sessão e dispare em outra do mesmo canal',
        hint: PLAN_HINTS.crossSession,
        exclusive: true,
        featureIcon: 'sessions',
      },
      {
        featureName: CROSS_CHANNEL_NAME,
        label: 'Monitore no Telegram e poste no WhatsApp, e vice-versa',
        hint: PLAN_HINTS.crossChannel,
        featureIcon: 'channels',
      },
      TELEGRAM_GROUPS_CHANNELS,
      telegramLinkRotation(2, 10),
      { label: STOREFRONT_BENEFIT_LABEL, hint: PLAN_HINTS.storefront },
      { label: 'Captura fora do horário de postagem', hint: PLAN_HINTS.captureOutsideWindow, exclusive: true },
      { label: 'Template para Instagram', exclusive: true },
      { label: 'Afiliado Shein', hint: PLAN_HINTS.sheinAffiliate, exclusive: true },
      { label: 'Caçador de Ofertas', hint: PLAN_HINTS.offerHunter, exclusive: true },
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
