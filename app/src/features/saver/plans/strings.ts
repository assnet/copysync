import { formatPrice } from '@/features/plans/strings';

/** Textos da vitrine do Saver (pt-BR, sem marca). Não promete nome nem número de todo membro. */
export const saverPlansStrings = {
  page: {
    title: 'Planos do Saver',
    subtitle: 'Guarde os contatos dos seus grupos de WhatsApp e baixe a lista em planilha ou na agenda do celular.',
    carouselLabel: 'Planos do Saver',
  },
  period: {
    label: 'Período de cobrança',
    monthly: 'Mensal',
    annual: 'Anual',
    annualHint: 'Pague o ano de uma vez e economize em todos os planos.',
  },
  card: {
    recommended: 'Mais escolhido',
    current: 'Seu plano',
    perMonth: '/mês',
    annualBilled: (total: number) => `${formatPrice(total)} cobrados anualmente`,
    monthlyBilled: 'Cobrado todo mês',
    fit: (fit: string) => `Ideal para ${fit}`,
    cta: 'Assinar pelo suporte',
    ctaTooltip: 'Abre a conversa com o suporte em uma nova aba para ativar o plano na sua conta.',
    currentCta: 'Plano ativo',
    operatorHint: 'Só o administrador da conta pode trocar o plano.',
  },
  limits: {
    unlimited: 'Ilimitado',
    groups: (n: number | null) => (n === null ? 'Grupos salvos ilimitados' : `Até ${n.toLocaleString('pt-BR')} grupos salvos`),
    contacts: (n: number | null) => (n === null ? 'Contatos guardados ilimitados' : `Até ${n.toLocaleString('pt-BR')} contatos guardados`),
    scans: (n: number) => `${n.toLocaleString('pt-BR')} leituras de grupo por dia`,
    scansHint: 'Cada leitura busca os participantes de um grupo. O ritmo é calmo de propósito, para proteger o seu número.',
    sessions: (n: number) => (n === 1 ? '1 número de WhatsApp' : `${n} números de WhatsApp`),
    autoRefresh: 'Atualização automática dos grupos salvos',
    autoRefreshHint: 'Os grupos salvos são lidos de novo sozinhos, sem você pedir.',
    noAutoRefresh: 'Atualização quando você pedir',
    exportFormats: 'Exporta em planilha (CSV) e contatos de celular (vCard)',
  },
  hiddenNumber: {
    title: 'Sobre os números ocultos',
    body: 'Alguns participantes escondem o número no WhatsApp. Nesses casos guardamos o identificador do participante e ele vai para a planilha, mas fica fora do arquivo de contatos do celular. O nome aparece quando o próprio participante o mostra no grupo.',
  },
  footnote: 'Preços em reais. O plano é ativado na sua conta pelo suporte; a cobrança segue o período escolhido.',
};
