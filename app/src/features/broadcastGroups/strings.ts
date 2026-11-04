/**
 * Textos da tela de grupos de disparo, centralizados até o painel ter uma lib de i18n (mesmas
 * regras de `features/monitoring/strings.ts`): chaves semânticas, frase com variável é função
 * tipada, sem nome de marca; termo de produto é "sessão", nunca "instância".
 */
import type { LimitChannel } from '@/types/api.types';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const count = (n: number) => n.toLocaleString('pt-BR');
const groups = (n: number) => `${count(n)} ${plural(n, 'grupo', 'grupos')}`;

const CHANNEL_LABEL: Record<LimitChannel, string> = { whatsapp: 'WhatsApp', telegram: 'Telegram' };

export const broadcastGroupsStrings = {
  title: 'Grupos de disparo',
  subtitle: 'Todos os grupos que recebem suas ofertas, do gerador e dos monitoramentos, em um só lugar.',
  limitHint: 'O limite do plano soma o gerador e todos os monitoramentos. Um grupo usado nos dois conta uma vez só.',
  channelLabel: (channel: LimitChannel) => CHANNEL_LABEL[channel],

  usage: {
    label: (channel: LimitChannel, n: number, limit: number | null) =>
      limit == null ? `${CHANNEL_LABEL[channel]} ${count(n)}` : `${CHANNEL_LABEL[channel]} ${count(n)}/${count(limit)}`,
    ariaLabel: (channel: LimitChannel, n: number, limit: number | null) =>
      limit == null
        ? `${groups(n)} de disparo no ${CHANNEL_LABEL[channel]}, sem limite no plano`
        : `${groups(n)} de disparo no ${CHANNEL_LABEL[channel]} de ${count(limit)} do plano`,
    overLimit: (channel: LimitChannel) =>
      `Você passou do limite de grupos do ${CHANNEL_LABEL[channel]}. Remova grupos para voltar a salvar novos destinos.`,
  },

  filters: {
    channel: 'Canal',
    channelAll: 'Todos os canais',
    search: 'Buscar grupo ou sessão',
    searchAria: 'Buscar grupo de disparo pelo nome do grupo ou da sessão',
    clear: 'Limpar filtros',
  },

  columns: {
    group: 'Grupo',
    session: 'Sessão',
    channel: 'Canal',
    usedBy: 'Usado em',
    actions: 'Ações',
  },

  usedBy: {
    generator: 'Gerador de ofertas',
    monitor: 'Monitoramento',
    monitorOf: (session: string) => `Monitoramento · ${session}`,
    generatorTooltip: 'Recebe as ofertas disparadas pelo gerador.',
    monitorTooltip: 'Recebe as ofertas capturadas pelo monitoramento desta sessão.',
  },

  untitledGroup: 'Grupo sem nome',
  unnamedSession: 'Sessão sem nome',

  remove: {
    action: 'Remover',
    tooltip: 'Tira o grupo do gerador e de todos os monitoramentos',
    ariaLabel: (group: string) => `Remover o grupo ${group} de todos os usos`,
    confirmTitle: 'Remover grupo de disparo?',
    confirmBody: (group: string, uses: number) =>
      `${group} deixa de receber ofertas em ${uses === 1 ? 'seu único uso' : `todos os ${count(uses)} usos`}. Envios já na fila seguem as regras da fila.`,
    confirm: 'Remover de todos',
    cancel: 'Cancelar',
    success: (group: string) => `${group} foi removido dos grupos de disparo.`,
    error: 'Não foi possível remover o grupo. Tente de novo.',
  },

  loadError: 'Não foi possível carregar os grupos de disparo.',
  retry: 'Tentar de novo',
  loading: 'Carregando grupos de disparo…',
  emptyTitle: 'Nenhum grupo de disparo ainda',
  emptyDescription: 'Escolha grupos no gerador de ofertas ou num monitoramento e eles aparecem aqui.',
  noResultsTitle: 'Nenhum grupo encontrado',
  noResultsDescription: 'Mude o canal ou a busca para ver outros grupos.',
  results: (n: number) => `${groups(n)}`,

  /** Dica nos chips do gerador e do monitoramento (T16). */
  sharedLimit: {
    tooltip: 'O limite soma o gerador e o monitoramento: um grupo usado nos dois conta uma vez.',
    link: 'Ver grupos de disparo',
  },
} as const;
