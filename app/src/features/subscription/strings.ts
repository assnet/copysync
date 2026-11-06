/**
 * Textos da tela "Assinatura", centralizados até o painel ter uma lib de i18n — mesmas regras de
 * `features/plans/strings.ts`:
 * - chaves semânticas, nunca o texto como chave
 * - frase com variável é função tipada; componente nunca concatena pedaços
 * - sem nome de marca do produto (white label) e sem preço (preço só na vitrine `/affiliates/plans`)
 *
 * As chaves de limite espelham `ENTITLEMENT_KEYS` da API (`api/src/modules/tenants/domain/entitlementKeys.ts`);
 * o teste ao lado trava a lista.
 */
import { PLAN_CATALOG, PLAN_HINTS, type PlanCatalogItem, type PlanSlug } from '@/features/plans/catalog';

export type SubscriptionStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
export type SubscriptionChannel = 'whatsapp' | 'telegram';

/** Chaves de entitlement exibidas na tabela de limites (contrato `limits[].key`). */
export const SUBSCRIPTION_LIMIT_KEYS = [
  'whatsapp_sessions',
  'telegram_sessions',
  'monitored_groups',
  'broadcast_groups',
  'telegram_monitored_groups',
  'telegram_broadcast_groups',
  'mention_all_enabled',
  'offer_generations_per_day',
  'marketplace_extension',
  'ai_rewrite_enabled',
  'ai_requests_per_day',
  'cross_session_dispatch',
  'link_rotations',
  'link_rotation_groups',
  'telegram_link_rotations',
  'telegram_link_rotation_groups',
  'storefront_enabled',
  'offer_story_enabled',
] as const;

export type SubscriptionLimitKey = (typeof SUBSCRIPTION_LIMIT_KEYS)[number];

type CatalogLimitField = keyof PlanCatalogItem['limits'];

/**
 * Menor plano que libera cada chave. Numérica com par em `catalog.ts` → derivada dos `limits` do
 * catálogo (primeiro plano com valor > 0); booleana ou fora da vitrine → plano fixo (espelha `PLAN_PRESETS`).
 */
const CATALOG_FIELD: Partial<Record<SubscriptionLimitKey, CatalogLimitField>> = {
  whatsapp_sessions: 'whatsappSessions',
  telegram_sessions: 'telegramSessions',
  monitored_groups: 'monitoredGroups',
  broadcast_groups: 'broadcastGroups',
  telegram_monitored_groups: 'telegramMonitoredGroups',
  telegram_broadcast_groups: 'telegramBroadcastGroups',
  link_rotations: 'linkRotations',
  link_rotation_groups: 'linkRotationGroups',
  telegram_link_rotations: 'telegramLinkRotations',
  telegram_link_rotation_groups: 'telegramLinkRotationGroups',
};

const FIXED_MIN_PLAN: Partial<Record<SubscriptionLimitKey, PlanSlug>> = {
  mention_all_enabled: 'profissional',
  storefront_enabled: 'profissional',
  cross_session_dispatch: 'business',
  offer_story_enabled: 'business',
  marketplace_extension: 'starter',
  ai_rewrite_enabled: 'starter',
  offer_generations_per_day: 'starter',
  ai_requests_per_day: 'starter',
};

/** Menor plano do catálogo que libera a chave, ou `null` se nenhum libera. */
export function minPlanFor(key: SubscriptionLimitKey): PlanCatalogItem | null {
  const field = CATALOG_FIELD[key];
  if (field) return PLAN_CATALOG.find((p) => p.limits[field] > 0) ?? null;
  const slug = FIXED_MIN_PLAN[key];
  return PLAN_CATALOG.find((p) => p.slug === slug) ?? null;
}

/** Nome de vitrine do plano pelo slug (`null` = sem plano). */
export function planNameOf(slug: PlanSlug | null): string | null {
  return PLAN_CATALOG.find((p) => p.slug === slug)?.name ?? null;
}

const count = (n: number) => n.toLocaleString('pt-BR');

export const subscriptionStrings = {
  menuLabel: 'Assinatura',

  page: {
    title: 'Assinatura',
    subtitle: 'Seu plano, a situação da assinatura e quanto você já usa de cada limite.',
    loadError: 'Não foi possível carregar a sua assinatura.',
    retry: 'Tentar de novo',
  },

  plan: {
    eyebrow: 'Plano atual',
    noPlan: 'Sem plano',
    noPlanTagline: 'Escolha um plano para liberar sessões, grupos e links.',
    tenantLabel: 'Conta',
  },

  status: {
    label: 'Situação da assinatura',
    ACTIVE: 'Ativa',
    SUSPENDED: 'Suspensa',
    CANCELLED: 'Cancelada',
    noPlan: 'Sem plano',
  } satisfies Record<SubscriptionStatus | 'noPlan' | 'label', string>,

  expiry: {
    /** `date` já formatada em data local pelo componente (`Intl.DateTimeFormat`). */
    renewsOn: (date: string) => `Renova em ${date}`,
    expiredOn: (date: string) => `Venceu em ${date}`,
    suspendedOn: (date: string) => `Suspensa desde ${date}`,
  },

  cta: {
    label: 'Ver planos e assinar',
    /** Leitor de tela: o link abre outra aba. */
    newTab: 'Ver planos e assinar (abre em nova aba)',
    tooltip: 'Compare os planos e conclua a assinatura numa página segura.',
    /** OPERATOR não assina (D4). */
    operatorHint: 'Para mudar de plano, fale com o administrador da conta.',
  },

  /** Aviso quando o tenant está com pendência (SUB-09). */
  pending: {
    SUSPENDED: {
      title: 'Assinatura suspensa',
      description: 'Há uma pendência no pagamento e os recursos estão pausados. Regularize para voltar a monitorar e disparar.',
    },
    CANCELLED: {
      title: 'Assinatura cancelada',
      description: 'Sua assinatura foi cancelada e os recursos estão pausados. Escolha um plano para voltar a usar.',
    },
    redirected: 'Você foi trazido para cá porque a assinatura precisa de atenção.',
  },

  limits: {
    title: 'Limites do plano',
    channelTabsLabel: 'Canal',
    general: 'Recursos gerais',
    column: { resource: 'Recurso', usage: 'Uso', limit: 'Limite' },
    unlimited: 'Ilimitado',
    included: 'Incluso',
    notIncluded: 'Não incluso',
    today: 'hoje',
    /** "3 de 10". */
    usage: (used: number, limit: number) => `${count(used)} de ${count(limit)}`,
    /** "3 de 10 hoje". */
    usageToday: (used: number, limit: number) => `${count(used)} de ${count(limit)} hoje`,
    /** Uso sem teto: "3 em uso" / "3 hoje". */
    usageUnlimited: (used: number) => `${count(used)} em uso`,
    usageUnlimitedToday: (used: number) => `${count(used)} hoje`,
    /** Barra de uso (leitor de tela). */
    usageAria: (label: string, used: number, limit: number) => `${label}: ${count(used)} de ${count(limit)}`,
    /** "A partir do PRO" — nome vindo do `PLAN_CATALOG`. */
    availableFrom: (planName: string) => `A partir do ${planName}`,
  },

  channel: {
    whatsapp: 'WhatsApp',
    telegram: 'Telegram',
  } satisfies Record<SubscriptionChannel, string>,

  /** Rótulo e Tooltip de cada limite. */
  limit: {
    whatsapp_sessions: { label: 'Sessões', hint: 'Números de WhatsApp conectados ao mesmo tempo.' },
    telegram_sessions: { label: 'Sessões', hint: 'Contas do Telegram conectadas ao mesmo tempo.' },
    monitored_groups: { label: 'Grupos monitorados', hint: PLAN_HINTS.monitoredGroups },
    broadcast_groups: { label: 'Grupos de disparo', hint: PLAN_HINTS.broadcastGroups },
    telegram_monitored_groups: { label: 'Grupos e canais monitorados', hint: PLAN_HINTS.telegramGroupsChannels },
    telegram_broadcast_groups: { label: 'Grupos e canais de disparo', hint: PLAN_HINTS.broadcastGroups },
    link_rotations: { label: 'Links no Gestor de Links', hint: PLAN_HINTS.linkRotation },
    link_rotation_groups: { label: 'Grupos por link', hint: 'Quantos grupos cada link do Gestor de Links pode distribuir.' },
    telegram_link_rotations: { label: 'Links no Gestor de Links', hint: PLAN_HINTS.telegramLinkRotation },
    telegram_link_rotation_groups: { label: 'Grupos e canais por link', hint: 'Quantos grupos e canais cada link do Gestor de Links pode distribuir.' },
    offer_generations_per_day: { label: 'Ofertas geradas', hint: 'Ofertas criadas no gerador por dia. O contador zera à meia-noite.' },
    ai_requests_per_day: { label: 'Pedidos de IA', hint: 'Textos reescritos pela IA por dia. O contador zera à meia-noite.' },
    mention_all_enabled: { label: 'Menção a todos', hint: PLAN_HINTS.mentionAll },
    marketplace_extension: { label: 'Extensão do navegador', hint: 'Gere ofertas direto da página do produto na Shopee, Amazon e Mercado Livre.' },
    ai_rewrite_enabled: { label: 'Reescrita com IA', hint: 'A IA reescreve o texto de cada oferta capturada antes do disparo.' },
    cross_session_dispatch: { label: 'Cross Session', hint: PLAN_HINTS.crossSession },
    storefront_enabled: { label: 'Página de Ofertas', hint: PLAN_HINTS.storefront },
    offer_story_enabled: { label: 'Story de Oferta', hint: 'Arte da oferta pronta para os stories do Instagram.' },
  } satisfies Record<SubscriptionLimitKey, { label: string; hint: string }>,
};
