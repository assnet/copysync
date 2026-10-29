/**
 * Textos do rodízio de links, centralizados até o painel ter uma lib de i18n — mesmas regras de
 * `features/monitoring/strings.ts`:
 * - chaves semânticas, nunca o texto como chave
 * - frase com variável é função tipada; componente nunca concatena pedaços
 * - sem nome de marca do produto; termo de produto é "sessão", nunca "instância"
 */
import type { RotationGroupStatus, RotationStatus, RotationStrategy } from './types';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const count = (n: number) => n.toLocaleString('pt-BR');

export const linkRotationStrings = {
  menuLabel: 'Rodízio de links',

  page: {
    title: 'Rodízio de links',
    subtitle: 'Um link fixo para divulgar nas redes que leva cada pessoa a um grupo com vaga',
    create: 'Criar link',
    createTooltip: 'Escolha o nome, a sessão e os grupos do novo link',
    limitReachedTooltip: 'Você já usa todos os links do seu plano. Veja como ter mais.',
    usage: (used: number, limit: number | null) =>
      limit === null ? `${count(used)} ${plural(used, 'link', 'links')}` : `${count(used)} de ${count(limit)} ${plural(limit, 'link', 'links')}`,
    loadError: 'Não foi possível carregar seus links.',
    retry: 'Tentar de novo',
    untitledSession: 'Sessão sem nome',
    sessionRemoved: 'Sessão removida',
  },

  empty: {
    title: 'Crie seu link de grupos',
    description:
      'Divulgue um único link na bio, nos stories e nos anúncios. Quem clica entra direto em um dos seus grupos com vaga — sem você trocar o link quando um grupo lota.',
    cta: 'Criar meu link',
    steps: ['Escolha o nome do link', 'Selecione os grupos', 'Copie e divulgue'],
    noDomain: 'Os links ainda não estão disponíveis. Assim que liberarmos um domínio, você poderá criar o seu.',
    noSession: 'Conecte uma sessão do WhatsApp para escolher os grupos do link.',
    connectSession: 'Conectar sessão',
  },

  card: {
    copy: 'Copiar',
    copied: 'Copiado!',
    copyTooltip: 'Copiar o link para colar nas redes',
    copyFailed: 'Não foi possível copiar. Selecione o link e copie manualmente.',
    openTooltip: 'Abrir o link em uma nova aba',
    statusSwitchAria: 'Link ativo',
    statusOnTooltip: 'Ativo: quem clica é levado a um grupo. Desligue para pausar.',
    statusOffTooltip: 'Pausado: quem clica vê um aviso de pausa. Ligue para voltar a distribuir.',
    pausedByPlanTooltip: 'Pausado porque o plano atual tem menos links. Faça upgrade ou remova outro link para reativar.',
    session: 'Sessão',
    strategy: 'Estratégia',
    groups: (used: number, limit: number | null) =>
      limit === null
        ? `${count(used)} ${plural(used, 'grupo', 'grupos')}`
        : `${count(used)} de ${count(limit)} ${plural(limit, 'grupo', 'grupos')}`,
    groupsTooltip: 'Grupos que recebem os cliques deste link e o limite do seu plano',
    clicks: (n: number) => `${count(n)} ${plural(n, 'clique', 'cliques')}`,
    noGroups: 'Nenhum grupo escolhido. Sem grupos, quem clica vê um aviso de indisponível.',
    configure: 'Configurar',
    configureTooltip: 'Nome do link, sessão e estratégia',
    manageGroups: 'Grupos',
    manageGroupsTooltip: 'Escolha os grupos, a ordem e o limite de cada um',
    moreActions: 'Mais ações',
    remove: 'Excluir link',
  },

  status: {
    ACTIVE: 'Ativo',
    PAUSED: 'Pausado',
    PAUSED_BY_PLAN: 'Pausado pelo plano',
  } satisfies Record<RotationStatus, string>,

  groupStatus: {
    ACTIVE: 'Recebendo cliques',
    PAUSED: 'Pausado',
    FULL: 'Lotado',
    NEEDS_LINK: 'Falta o link de convite',
    PAUSED_BY_PLAN: 'Fora do limite do plano',
  } satisfies Record<RotationGroupStatus, string>,

  groupStatusHelp: {
    ACTIVE: 'O grupo tem vaga e entra no rodízio.',
    PAUSED: 'Você pausou este grupo; ele não recebe cliques.',
    FULL: 'O grupo chegou ao limite de membros. Volta sozinho quando abrir vaga.',
    NEEDS_LINK: 'A sessão não é admin do grupo. Torne-a admin ou cole o link de convite manualmente.',
    PAUSED_BY_PLAN: 'Seu plano atual tem menos grupos. Faça upgrade para reativar.',
  } satisfies Record<RotationGroupStatus, string>,

  strategy: {
    label: {
      BALANCED: 'Equilibrado',
      SEQUENTIAL: 'Um de cada vez',
      WEIGHTED: 'Por peso',
      RANDOM: 'Aleatório',
    } satisfies Record<RotationStrategy, string>,
    description: {
      BALANCED: 'Manda cada pessoa para o grupo mais vazio. Os grupos crescem por igual.',
      SEQUENTIAL: 'Enche um grupo até o limite e só então passa para o próximo da lista.',
      WEIGHTED: 'Você dá um peso a cada grupo: peso 3 recebe cerca de três vezes mais cliques que peso 1.',
      RANDOM: 'Sorteia um grupo com vaga a cada clique.',
    } satisfies Record<RotationStrategy, string>,
  },

  config: {
    createTitle: 'Criar link',
    editTitle: 'Configurar link',
    session: 'Sessão',
    sessionHelp: 'A sessão precisa estar nos grupos. Se ela for admin, o link de convite é buscado sozinho.',
    domain: 'Domínio',
    slug: 'Nome do link',
    slugHelp: 'Letras minúsculas, números e hífen. De 3 a 50 caracteres.',
    slugCounter: (n: number, max: number) => `${n}/${max}`,
    preview: 'Seu link vai ficar assim',
    suggestions: 'Esse nome já está em uso. Que tal um destes?',
    strategy: 'Como distribuir os cliques',
    title: 'Apelido (opcional)',
    titleHelp: 'Só você vê. Ajuda a diferenciar seus links.',
    renameConfirmTitle: 'Trocar o nome do link?',
    renameConfirmBody: (oldUrl: string) =>
      `O link antigo (${oldUrl}) para de funcionar. Atualize o link em todos os lugares onde ele foi divulgado. O nome antigo fica reservado para você por 30 dias.`,
    renameConfirm: 'Trocar nome',
    cancel: 'Cancelar',
    save: 'Salvar',
    create: 'Criar link',
    close: 'Fechar',
  },

  groups: {
    title: 'Grupos do link',
    subtitle: 'Quem clica no link entra em um destes grupos, conforme a estratégia escolhida.',
    search: 'Buscar grupo',
    selectedCount: (selected: number, limit: number | null) =>
      limit === null ? `${count(selected)} ${plural(selected, 'selecionado', 'selecionados')}` : `${count(selected)} de ${count(limit)} selecionados`,
    partial: 'A lista pode estar incompleta: a sessão ainda está carregando os grupos.',
    empty: 'Nenhum grupo encontrado nesta sessão.',
    emptySearch: 'Nenhum grupo com esse nome.',
    moveUp: 'Subir na ordem',
    moveDown: 'Descer na ordem',
    weight: 'Peso',
    weightHelp: 'Quanto maior, mais cliques o grupo recebe.',
    capacity: 'Limite de membros',
    capacityHelp: 'Ao chegar aqui, o grupo para de receber cliques até abrir vaga.',
    capacityValue: (n: number) => `${count(n)} membros`,
    linkAuto: 'Link de convite automático',
    linkManual: 'Link de convite manual',
    manualInviteUrl: 'Link de convite do grupo',
    manualInviteHelp: 'Cole o link no formato https://chat.whatsapp.com/…',
    refresh: 'Atualizar agora',
    refreshTooltip: 'Relê o link de convite e o número de membros',
    members: (n: number | null, capacity: number) =>
      n === null ? `? de ${count(capacity)} membros` : `${count(n)} de ${count(capacity)} membros`,
    cancel: 'Cancelar',
    save: 'Salvar grupos',
    close: 'Fechar',
  },

  upgrade: {
    eyebrow: 'Hora de crescer',
    rotationsTitle: 'Você usou todos os links do seu plano',
    groupsTitle: 'Seu link já tem todos os grupos do plano',
    rotationsBody: (limit: number) =>
      `Seu plano inclui ${count(limit)} ${plural(limit, 'link', 'links')} de rodízio. Com um plano maior você divulga mais links ao mesmo tempo.`,
    groupsBody: (limit: number) =>
      `Seu plano permite até ${count(limit)} ${plural(limit, 'grupo', 'grupos')} por link. Com mais grupos, cabe mais gente sem o link lotar.`,
    nextPlan: (planName: string, limit: number, kind: 'rotations' | 'groups') =>
      kind === 'rotations'
        ? `No ${planName} são ${count(limit)} ${plural(limit, 'link', 'links')}.`
        : `No ${planName} são até ${count(limit)} grupos por link.`,
    cta: 'Ver planos',
    dismiss: 'Agora não',
  },

  stats: {
    title: 'Cliques',
    total: 'Total',
    last7Days: 'Últimos 7 dias',
    lastClick: 'Último clique',
    never: 'Ainda sem cliques',
    perGroup: 'Por grupo',
    loadError: 'Não foi possível carregar os cliques.',
  },

  toast: {
    created: 'Link criado. Agora escolha os grupos.',
    saved: 'Alterações salvas.',
    renamed: 'Nome do link trocado.',
    removed: 'Link excluído.',
    activated: 'Link ativado.',
    paused: 'Link pausado.',
    groupsSaved: 'Grupos salvos.',
    groupRefreshed: 'Grupo atualizado.',
  },

  errors: {
    generic: 'Algo deu errado. Tente de novo em instantes.',
    planLimitRotations: (limit: number | null) =>
      limit === null ? 'Você chegou ao limite de links do seu plano.' : `Seu plano permite ${count(limit)} ${plural(limit, 'link', 'links')} de rodízio.`,
    planLimitGroups: (limit: number | null) =>
      limit === null ? 'Você chegou ao limite de grupos do seu plano.' : `Seu plano permite até ${count(limit)} ${plural(limit, 'grupo', 'grupos')} por link.`,
    slugTaken: 'Esse nome já está em uso. Escolha outro.',
    slugReserved: 'Esse nome é reservado. Escolha outro.',
    slugInvalid: 'Use de 3 a 50 caracteres: letras minúsculas, números e hífen.',
    rotationNotFound: 'Este link não existe mais. Atualize a página.',
    groupInvalid: 'Um dos grupos escolhidos não pertence a esta sessão.',
    inviteUrlInvalid: 'Link de convite inválido. Use o formato https://chat.whatsapp.com/…',
    domainInvalid: 'Domínio inválido ou indisponível. Escolha outro.',
    domainTaken: (hostname: string | null) => (hostname ? `O domínio ${hostname} já está cadastrado.` : 'Esse domínio já está cadastrado.'),
    domainInUse: 'Este domínio está em uso por links de clientes e não pode ser removido.',
    notConfigured: 'O rodízio de links está temporariamente indisponível. Tente mais tarde.',
    inviteNotAllowed: 'A sessão não é admin do grupo. Torne-a admin ou cole o link de convite manualmente.',
    engineNotReady: 'A sessão está iniciando. Tente de novo em alguns segundos.',
    sessionNotConnected: 'A sessão está desconectada. Conecte-a para continuar.',
  },
};
