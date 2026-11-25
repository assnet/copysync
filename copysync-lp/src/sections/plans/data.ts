// Dados copiados do componente de Planos do app (app.copysync.app/affiliates/plans, v0.122.1),
// incluindo os textos dos tooltips. Manter em sincronia com o app.
import type { Marketplace } from '../../components/Marketplaces'

export type Period = 'monthly' | 'annual'

export const HINTS = {
  monitoredGroups: 'Grupos de onde as ofertas são capturadas: cada anúncio novo é lido, reescrito e ganha o seu link.',
  broadcastGroups: 'Grupos que recebem os disparos, na ordem e nos horários que você definir.',
  linkRotation: 'Um link fixo para divulgar nas redes. Nunca expira e leva cada visitante a um grupo com vaga.',
  telegramLinkRotation:
    'Um link fixo para divulgar nas redes que distribui os visitantes entre os seus grupos e canais do Telegram, sempre para um com vaga. Para gerar o convite ou colar o link, sua conta precisa ser admin do grupo ou canal.',
  mentionAll: 'Marca todos os participantes do grupo no disparo para aumentar a visualização.',
  captureOutsideWindow:
    'Fora do horário de postagem o monitoramento continua capturando: as ofertas ficam na fila e saem assim que o horário abrir.',
  enrichLinkOnly: 'No monitoramento, mensagem que chega só com o link vira oferta completa, com título, preço e foto do produto.',
  aiRewrite: 'A IA reescreve o texto de cada oferta para o público escolhido, no gerador de ofertas e no monitoramento.',
  sheinAffiliate:
    'Ofertas da Shein com o seu link de afiliado, no gerador e no monitoramento. Pede o aceite de um aviso de risco antes do uso.',
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
  mercadoLivreTags: 'Quantas etiquetas da sua conta de afiliado você pode usar nos links das ofertas.',
} as const

export type Benefit = {
  label: string
  hint?: string
  strong?: boolean
  exclusive?: boolean
  /** caixa azul-clara com ícone do Telegram */
  telegram?: { detail?: string }
  /** caixa lilás com ícone (Cross Session / Cross Channel) */
  feature?: { name: string; icon: 'sessions' | 'channels' }
  /** caixa lilás de destaque (Afiliado Shein) */
  spotlight?: { detail: string }
  marketplaces?: Marketplace[]
}

export type Plan = {
  slug: 'lite' | 'pro' | 'max'
  name: string
  tagline: string
  priceFrom: number
  price: number
  priceAnnualMonthly: number
  /** 🔹 linha de clareza do anual (brief v5) */
  annualDetail: string
  checkout: Record<Period, string>
  recommended?: boolean
  limits: {
    whatsappSessions: number
    telegramSessions: number
    monitoredGroups: number
    broadcastGroups: number
    telegramMonitoredGroups: number
    telegramBroadcastGroups: number
    linkRotations: number
    linkRotationGroups: number
    telegramLinkRotations: number
    telegramLinkRotationGroups: number
    mercadoLivreTags: number
  }
  benefits: Benefit[]
  fit: string
}

const telegramChannels: Benefit = {
  label: 'Telegram: monitore e envie em grupos e canais',
  hint: HINTS.telegramGroupsChannels,
  telegram: {},
}
const telegramLinks = (links: number, groups: number): Benefit => ({
  label: 'Gestor de Links no Telegram',
  hint: HINTS.telegramLinkRotation,
  telegram: { detail: `${links} ${links === 1 ? 'link' : 'links'} · até ${groups} grupos` },
})

export const PLANS: Plan[] = [
  {
    slug: 'lite',
    name: 'LITE',
    tagline: 'Para começar a monetizar seus grupos',
    priceFrom: 161.9,
    price: 97,
    priceAnnualMonthly: 77,
    annualDetail: '12x de R$ 77 (R$ 924/ano) ou R$ 745,52 à vista',
    checkout: {
      monthly: 'https://pay.cakto.com.br/8e4gepk_1291207',
      annual: 'https://pay.cakto.com.br/a92kn9k_1291217',
    },
    limits: {
      whatsappSessions: 1,
      telegramSessions: 0,
      monitoredGroups: 1,
      broadcastGroups: 5,
      telegramMonitoredGroups: 0,
      telegramBroadcastGroups: 0,
      linkRotations: 1,
      linkRotationGroups: 3,
      telegramLinkRotations: 0,
      telegramLinkRotationGroups: 0,
      mercadoLivreTags: 1,
    },
    benefits: [
      { label: 'Disparo em massa com agendamento de horários' },
      { label: 'Gerador de ofertas' },
      { label: 'Envio "digitando…" antes de cada oferta', hint: HINTS.typing },
      { label: 'Shopee, Mercado Livre e Amazon', marketplaces: ['shopee', 'mercado-livre', 'amazon'] },
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
    annualDetail: '12x de R$ 133,01 (R$ 1.596,12/ano) ou R$ 1.287,72 à vista',
    checkout: {
      monthly: 'https://pay.cakto.com.br/fronsgu_1291227',
      annual: 'https://pay.cakto.com.br/f34qfgh_1291232',
    },
    recommended: true,
    limits: {
      whatsappSessions: 1,
      telegramSessions: 1,
      monitoredGroups: 2,
      broadcastGroups: 10,
      telegramMonitoredGroups: 2,
      telegramBroadcastGroups: 10,
      linkRotations: 1,
      linkRotationGroups: 5,
      telegramLinkRotations: 1,
      telegramLinkRotationGroups: 5,
      mercadoLivreTags: 2,
    },
    benefits: [
      { label: 'Tudo do LITE', strong: true },
      telegramChannels,
      telegramLinks(1, 5),
      { label: 'Ofertas circulando entre WhatsApp e Telegram', hint: HINTS.bothChannels },
      { label: 'Menção a todos os participantes', hint: HINTS.mentionAll },
      { label: 'Oferta montada a partir só do link', hint: HINTS.enrichLinkOnly },
      { label: 'Reescrita com IA para o seu público', hint: HINTS.aiRewrite },
      { label: 'Página de Ofertas para a bio', hint: HINTS.storefront },
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
    annualDetail: '12x de R$ 197 (R$ 2.364/ano) ou R$ 1.907,37 à vista',
    checkout: {
      monthly: 'https://pay.cakto.com.br/kzoagvc_1291239',
      annual: 'https://pay.cakto.com.br/97nqcb8_1291245',
    },
    limits: {
      whatsappSessions: 2,
      telegramSessions: 2,
      monitoredGroups: 6,
      broadcastGroups: 40,
      telegramMonitoredGroups: 6,
      telegramBroadcastGroups: 40,
      linkRotations: 2,
      linkRotationGroups: 10,
      telegramLinkRotations: 2,
      telegramLinkRotationGroups: 10,
      mercadoLivreTags: 10,
    },
    benefits: [
      { label: 'Tudo do PRO', strong: true },
      {
        label: 'Monitore em uma sessão e dispare em outra do mesmo canal',
        hint: HINTS.crossSession,
        exclusive: true,
        feature: { name: 'Cross Session', icon: 'sessions' },
      },
      {
        label: 'Monitore no Telegram e poste no WhatsApp, e vice-versa',
        hint: HINTS.crossChannel,
        feature: { name: 'Cross Channel', icon: 'channels' },
      },
      telegramChannels,
      telegramLinks(2, 10),
      { label: 'Página de Ofertas para a bio', hint: HINTS.storefront },
      { label: 'Captura fora do horário de postagem', hint: HINTS.captureOutsideWindow, exclusive: true },
      { label: 'Template para Instagram', exclusive: true },
      {
        label: 'Afiliado Shein',
        hint: HINTS.sheinAffiliate,
        exclusive: true,
        marketplaces: ['shein'],
        spotlight: { detail: 'Seu link de afiliado no gerador e no monitoramento' },
      },
      { label: 'Caçador de Ofertas', hint: HINTS.offerHunter, exclusive: true },
      { label: 'Suporte exclusivo 24/7' },
    ],
    fit: 'equipes e operações com mais de um número ou nicho.',
  },
]

const brlInt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const brlDec = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
/** Igual ao app: inteiro sem centavos, quebrado com centavos. */
export const brl = (v: number) => (Number.isInteger(Math.round(v * 100) / 100) ? brlInt : brlDec).format(Math.round(v * 100) / 100)

export function priceFor(plan: Plan, period: Period) {
  return period === 'annual'
    ? {
        from: plan.price,
        price: plan.priceAnnualMonthly,
        billed: 'cobrado anualmente',
        savings: `economize ${brl((plan.price - plan.priceAnnualMonthly) * 12)}/ano`,
      }
    : {
        from: plan.priceFrom,
        price: plan.price,
        billed: 'cobrado mensalmente',
        savings: `economize ${brl(plan.priceFrom - plan.price)}/mês`,
      }
}
