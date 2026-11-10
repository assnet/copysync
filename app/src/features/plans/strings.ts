/**
 * Textos da vitrine de planos, centralizados até o painel ter uma lib de i18n — mesmas regras
 * de `features/settings/strings.ts`: chaves semânticas, frase com variável é função tipada,
 * sem nome de marca (white label).
 */

const whole = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** R$ 97 (inteiro) ou R$ 64,90 (com centavos): nunca "64,9". */
export function formatPrice(value: number): string {
  return (Number.isInteger(value) ? whole : cents).format(value);
}

/** Partes do limite do rodízio (plural pelo número): `{ links: '1 link', groups: 'até 5 grupos' }`. */
export function linkRotationLimitParts(links: number, groups: number): { links: string; groups: string } {
  return { links: `${links} ${links === 1 ? 'link' : 'links'}`, groups: `até ${groups} ${groups === 1 ? 'grupo' : 'grupos'}` };
}

/** Limite do rodízio numa linha: "1 link · até 5 grupos". */
export function linkRotationLimitLabel(links: number, groups: number): string {
  const p = linkRotationLimitParts(links, groups);
  return `${p.links} · ${p.groups}`;
}

/** Destaque do rodízio no Telegram (PRO e MAX); o limite vai em `detail` ("1 link · até 5 grupos"). */
export const TELEGRAM_LINK_ROTATION_LABEL = 'Gestor de Links no Telegram';

export const plansStrings = {
  menuLabel: 'Planos',
  /** Selo no item de menu de recurso exclusivo dos planos pagos maiores. */
  badgeProfessional: 'PRO',
  badgeBusiness: 'MAX',
  /** Selos de plano ao lado de opção exclusiva (`PlanAvailabilityBadges`). */
  availability: {
    tooltip: (names: readonly string[]) =>
      names.length === 1 ? `Exclusivo do plano ${names[0]}` : `Disponível nos planos ${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`,
  },

  /** Aviso no topo de `/affiliates/plans?feature=<chave>` quando o usuário chega barrado por um recurso. */
  featureNotice: {
    storefront: 'Faça upgrade agora mesmo e acesse a Página de Ofertas, exclusiva dos planos PRO e MAX',
    offerStory: 'Faça upgrade e crie stories de oferta para o Instagram, exclusivo do plano MAX.',
  },

  page: {
    title: 'Planos',
    subtitle: 'Escolha o plano que acompanha o tamanho da sua operação.',
    /** Nome do carrossel de planos no mobile (leitor de tela). */
    carouselLabel: 'Planos disponíveis',
  },

  hero: {
    eyebrow: 'Planos e limites',
    title: 'Escolha seu plano',
    lead: 'Monitoramento, disparo e links de afiliado em todos os planos.',
    leadDetail: 'O que muda é quantos grupos e canais você opera ao mesmo tempo.',
  },

  period: {
    groupLabel: 'Período de cobrança',
    monthly: 'Mensal',
    annual: 'Anual',
    discount: (percent: number) => `−${percent}%`,
  },

  guarantee: {
    ribbon: 'Garantia',
    days: '7',
    daysLabel: 'dias',
    aria: '7 dias de garantia. Não gostou? Devolvemos 100% do valor pago, sem perguntas.',
  },

  card: {
    recommended: 'Mais escolhido',
    exclusive: 'Exclusivo',
    perMonth: '/mês',
    billedMonthly: 'cobrado mensalmente',
    billedAnnually: 'cobrado anualmente',
    from: (value: string) => `de ${value}`,
    savingsPerMonth: (value: string) => `economize ${value}/mês`,
    savingsPerYear: (value: string) => `economize ${value}/ano`,
    cta: (planName: string) => `Assinar ${planName}`,
    /** Nome acessível do botão: avisa que o pagamento abre em nova aba. */
    ctaNewTab: (planName: string) => `Assinar ${planName} (abre o pagamento em nova aba)`,
    ctaHint: 'Sem fidelidade. Cancele quando quiser.',
    fit: 'Ideal para',
    everythingFrom: (planName: string) => `Tudo do ${planName}`,
  },

  /** Tabela de limites por canal no card (linhas = recurso, colunas = canal). */
  channels: {
    caption: (planName: string) => `Limites por canal no plano ${planName}`,
    resource: 'Recurso',
    whatsapp: 'WhatsApp',
    telegram: 'Telegram',
    sessions: 'Sessões',
    monitoredGroups: 'Grupos monitorados',
    broadcastGroups: 'Grupos de disparo',
    linkRotation: 'Gestor de Links',
    /** Leitor de tela da célula do rodízio: "1 link, até 5 grupos por link". */
    linkRotationAria: (links: string, groups: string) => `${links}, ${groups} por link`,
    /** Canal fora do plano: convite, não negativa. */
    availableFrom: (planName: string) => `A partir do ${planName}`,
  },

  trust: {
    securePayment: 'Pagamento seguro e criptografado',
    cancelAnytime: 'Cancele quando quiser',
    humanSupport: 'Suporte humano de verdade',
    guarantee: '7 dias de garantia, 100% de volta',
    upgradeAnytime: 'Faça upgrade a qualquer momento',
  },

  footnote: 'Limites de uso se aplicam. Preços e planos sujeitos a alteração.',
};
