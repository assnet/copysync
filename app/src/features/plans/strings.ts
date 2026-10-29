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

/** Limite do rodízio na vitrine: "1 link de rodízio · até 3 grupos" (plural pelo número). */
export function linkRotationLimitLabel(links: number, groups: number): string {
  return `${links} ${links === 1 ? 'link' : 'links'} de rodízio · até ${groups} ${groups === 1 ? 'grupo' : 'grupos'}`;
}

export const plansStrings = {
  menuLabel: 'Planos',
  /** Selo no item de menu de recurso exclusivo dos planos pagos maiores. */
  badgeProfessional: 'Profissional',

  /** Aviso no topo de `/plans?feature=<chave>` quando o usuário chega barrado por um recurso. */
  featureNotice: {
    storefront: 'Faça upgrade agora mesmo e acesse a Página de Ofertas, exclusiva dos planos Profissional e Business',
  },

  page: {
    title: 'Planos',
    subtitle: 'Escolha o plano que acompanha o tamanho da sua operação.',
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
    ctaHint: 'Sem fidelidade. Cancele quando quiser.',
    fit: 'Ideal para',
    everythingFrom: (planName: string) => `Tudo do ${planName}`,
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
