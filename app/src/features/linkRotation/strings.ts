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
    subtitle: 'Um link fixo para divulgar nas redes que leva cada pessoa a um grupo com vaga.',
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
    configure: 'Configurar',
    configureTooltip: 'Nome do link, sessão e estratégia',
    manageGroups: 'Grupos',
    manageGroupsTooltip: 'Escolha os grupos, a ordem e o limite de cada um',
    moreActions: 'Mais ações',
    remove: 'Excluir link',
    removeConfirmTitle: 'Excluir este link?',
    removeConfirmBody:
      'O link para de funcionar na hora: quem clicar verá uma página de link inexistente. O nome fica guardado só para você por 30 dias, caso queira criá-lo de novo.',
    removeConfirm: 'Excluir link',
    removeCancel: 'Cancelar',
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
    suggestions: 'Que tal um destes?',
    strategy: 'Como distribuir os cliques',
    title: 'Apelido (opcional)',
    titleHelp: 'Aparece no topo da página do link. Deixe em branco para não mostrar.',
    renameConfirmTitle: 'Trocar o nome do link?',
    renameConfirmBody:
      'O link atual para de funcionar na hora. Troque-o em todos os lugares onde ele foi divulgado. O nome antigo fica reservado só para você por 30 dias, caso queira voltar.',
    renameConfirm: 'Trocar nome',
    cancel: 'Cancelar',
    save: 'Salvar',
    create: 'Criar link',
    close: 'Fechar',
    slugPlaceholder: 'ex.: ofertas-da-ana',
    slugRulesTooltip: 'Maiúsculas, acentos e espaços são ajustados enquanto você digita.',
    slugRequired: 'Escolha um nome para o link.',
    slugTooShort: (min: number) => `Use pelo menos ${min} caracteres.`,
    previewPlaceholder: 'seu-nome',
    suggestionUse: (slug: string) => `Usar o nome ${slug}`,
    domainHelp: 'Endereço que vem depois do nome do link.',
    sessionUntitled: 'Sessão sem nome',
    sessionStatusTooltip: 'Situação da conexão desta sessão com o WhatsApp',
    sessionDisconnected: 'Esta sessão não está conectada. Você pode salvar, mas os grupos e os links de convite só são lidos com ela conectada.',
    sessionChangeWarning: (n: number) =>
      `Ao trocar a sessão, ${n === 1 ? 'o grupo escolhido sai' : `os ${n.toLocaleString('pt-BR')} grupos escolhidos saem`} do link. Depois você escolhe os grupos da nova sessão.`,
    titlePlaceholder: 'ex.: Ofertas da semana',
    statusLabel: 'Link ativo',
    renameOld: 'Link atual',
    renameNew: 'Novo link',
    saving: 'Salvando…',
    partialSaved: 'O nome do link foi trocado, mas as outras alterações não foram salvas. Tente de novo.',
  },

  groups: {
    title: 'Grupos do link',
    subtitle: 'Quem clica no link entra em um destes grupos, conforme a estratégia escolhida.',
    search: 'Buscar grupo',
    selectedCount: (selected: number, total: number) =>
      `${count(selected)} de ${count(total)} ${plural(total, 'selecionado', 'selecionados')}`,
    planLimit: (limit: number | null) =>
      limit === null ? 'Sem limite de grupos no plano' : `Limite do plano: ${count(limit)} ${plural(limit, 'grupo', 'grupos')}`,
    planLimitTooltip: 'Quantos grupos cada link pode ter no seu plano. Pode usar menos, se quiser.',
    strategyLine: (label: string, description: string) => `${label}: ${description}`,
    selectedTitle: 'Ordem dos grupos',
    availableTitle: 'Grupos da sessão',
    noneSelected: 'Marque abaixo os grupos que vão receber as pessoas.',
    orderHelp: 'No modo "Um de cada vez", o primeiro da lista enche antes de passar ao próximo. Nas outras estratégias a ordem só organiza a lista.',
    untitled: 'Grupo sem nome',
    selectAria: (name: string) => `Usar ${name} no link`,
    remove: 'Tirar do link',
    loadError: 'Não foi possível carregar os grupos da sessão.',
    retry: 'Tentar de novo',
    partial: 'A lista pode estar incompleta: a sessão ainda está carregando os grupos.',
    empty: 'Nenhum grupo encontrado nesta sessão. A sessão precisa participar dos grupos: adicione o número dela aos grupos que você quer usar.',
    emptySearch: 'Nenhum grupo com esse nome.',
    moveUp: 'Subir na ordem',
    moveDown: 'Descer na ordem',
    moveUpAria: (name: string) => `Subir ${name} na ordem`,
    moveDownAria: (name: string) => `Descer ${name} na ordem`,
    removeAria: (name: string) => `Tirar ${name} do link`,
    refreshAria: (name: string) => `Atualizar ${name} agora`,
    atCapacity: 'No limite',
    atCapacityHelp:
      'Pelos cliques desde a última leitura, o grupo já chegou ao limite de membros. Ele sai do rodízio até a próxima leitura de membros.',
    membersEstimatedHelp: (read: number, clicks: number) =>
      `Estimativa: ${count(read)} na última leitura + ${count(clicks)} ${plural(clicks, 'clique', 'cliques')} desde então.`,
    weight: 'Peso',
    weightHelp: 'Quanto maior, mais cliques o grupo recebe. Peso 3 recebe cerca de três vezes mais que peso 1.',
    weightValue: (n: number) => `Peso ${count(n)}`,
    capacity: 'Limite de membros',
    capacityHelp:
      'O WhatsApp aceita até 1.024 pessoas por grupo. Deixe uma folga (ex.: 1.000) para admins e quem entra por outro caminho. Ao chegar no limite, o grupo sai do rodízio até abrir vaga.',
    capacityValue: (n: number) => `${count(n)} membros`,
    linkSource: 'Origem do link de convite',
    linkAuto: 'Automático',
    linkAutoHelp: 'A sessão gera o link de convite sozinha. Ela precisa ser admin do grupo.',
    linkManual: 'Manual',
    linkManualHelp: 'Você cola o link de convite do grupo. Use quando a sessão não é admin.',
    manualInviteUrl: 'Link de convite do grupo',
    manualInviteHelp: 'Cole o link no formato https://chat.whatsapp.com/…',
    manualInviteRequired: 'Cole o link de convite do grupo.',
    statusNew: 'Novo',
    statusNewHelp: 'Salve para o grupo entrar no rodízio.',
    refresh: 'Atualizar agora',
    refreshTooltip: 'Relê o link de convite e o número de membros',
    members: (n: number | null, capacity: number) =>
      n === null ? `? de ${count(capacity)} membros` : `${count(n)} de ${count(capacity)} membros`,
    membersEstimated: (n: number, capacity: number) => `cerca de ${count(n)} de ${count(capacity)} membros`,
    cancel: 'Cancelar',
    save: 'Salvar grupos',
    close: 'Fechar',
  },

  upgrade: {
    eyebrow: 'Hora de crescer',
    rotationsTitle: 'Seus links estão a todo vapor!',
    groupsTitle: 'Seu link está pronto para mais gente!',
    rotationsBody: (limit: number) =>
      `Seu plano inclui ${count(limit)} ${plural(limit, 'link', 'links')} de rodízio. Com um plano maior você divulga mais links ao mesmo tempo.`,
    groupsBody: (limit: number) =>
      `Seu plano permite até ${count(limit)} ${plural(limit, 'grupo', 'grupos')} por link. Com mais grupos, cabe mais gente sem o link lotar.`,
    nextPlan: (planName: string, limit: number, kind: 'rotations' | 'groups') =>
      kind === 'rotations'
        ? `No ${planName} são ${count(limit)} ${plural(limit, 'link', 'links')}.`
        : `No ${planName} são até ${count(limit)} grupos por link.`,
    rotationsBenefit: 'Um link para cada rede, campanha ou nicho, todos funcionando ao mesmo tempo.',
    groupsBenefit: 'Mais vagas no mesmo link, sem trocar nada do que você já divulgou.',
    compareNow: 'Seu plano',
    unit: (n: number, kind: 'rotations' | 'groups') =>
      kind === 'rotations' ? plural(n, 'link', 'links') : plural(n, 'grupo', 'grupos'),
    compareAria: (now: number, planName: string, next: number, kind: 'rotations' | 'groups') =>
      kind === 'rotations'
        ? `Hoje: ${count(now)} ${plural(now, 'link', 'links')}. No ${planName}: ${count(next)} ${plural(next, 'link', 'links')}.`
        : `Hoje: ${count(now)} ${plural(now, 'grupo', 'grupos')} por link. No ${planName}: ${count(next)} grupos por link.`,
    topPlanTitle: 'Você já está no maior plano',
    topPlanBody: (limit: number, kind: 'rotations' | 'groups') =>
      kind === 'rotations'
        ? `Você usa os ${count(limit)} ${plural(limit, 'link', 'links')} disponíveis. Para criar outro, exclua um link que não usa mais.`
        : `Seu link já usa os ${count(limit)} grupos disponíveis. Para alcançar mais gente, crie outro link ou troque um grupo por outro.`,
    topPlanDismiss: 'Entendi',
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
    retry: 'Tentar de novo',
    refresh: 'Atualizar cliques',
    refreshTooltip: 'Busca os números mais recentes deste link',
    /** `diffMs` = horário do clique − agora no servidor (negativo = passado). */
    lastClickRelative: (diffMs: number) => {
      const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
      const s = Math.round(diffMs / 1000);
      if (Math.abs(s) < 60) return 'agora mesmo';
      const m = Math.round(s / 60);
      if (Math.abs(m) < 60) return rtf.format(m, 'minute');
      const h = Math.round(m / 60);
      if (Math.abs(h) < 24) return rtf.format(h, 'hour');
      const d = Math.round(h / 24);
      if (Math.abs(d) < 30) return rtf.format(d, 'day');
      const mo = Math.round(d / 30);
      return Math.abs(mo) < 12 ? rtf.format(mo, 'month') : rtf.format(Math.round(d / 365), 'year');
    },
    noGroups: 'Nenhum grupo escolhido. Sem grupos, quem clica vê um aviso de indisponível.',
    untitledGroup: 'Grupo sem nome',
    groupClicks7d: (n: number) => `${count(n)} em 7 dias`,
    groupClicksTooltip: (total: number) => `Cliques nos últimos 7 dias. Desde o início: ${count(total)}.`,
    occupancy: (members: number, capacity: number) => `${count(members)}/${count(capacity)}`,
    occupancyAria: (members: number, capacity: number, pct: number) =>
      `Ocupação: ${count(members)} de ${count(capacity)} membros (${count(pct)}%)`,
    occupancyTooltip: 'Membros do grupo em relação ao limite que você definiu',
    notMeasured: 'Ainda não medido',
    notMeasuredAria: 'Ocupação ainda não medida',
    notMeasuredHelp: 'O número de membros ainda não foi lido. Ele é atualizado sozinho em alguns minutos.',
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
