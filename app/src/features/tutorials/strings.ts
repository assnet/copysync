/**
 * Textos da central de tutoriais (padrão i18n do painel: chaves semânticas, frase com variável é
 * função tipada, sem nome de marca — white label). Aula: `lessons[id]`, mesma chave do `catalog.ts`.
 */
export const tutorialsStrings = {
  navLabel: 'Tutoriais',
  title: 'Central de tutoriais',
  subtitle: 'Aprenda o passo a passo em vídeo e continue de onde parou, sempre que voltar.',

  hero: {
    eyebrow: 'Aprenda no seu ritmo',
    headline: 'Domine a plataforma em videoaulas objetivas',
    pill: {
      lessons: (n: number) => (n === 1 ? 'aula' : 'aulas'),
      groups: 'trilhas',
      free: 'acesso livre',
    },
    featured: {
      start: 'Comece por aqui',
      resume: 'Continue de onde parou',
      next: 'Próxima aula da trilha',
      review: 'Trilha concluída',
    },
    watchNow: 'Assistir agora',
    continueCta: 'Continuar',
    reviewCta: 'Rever a primeira aula',
    resumeFrom: (clock: string) => `Retoma em ${clock}`,
    upcoming: (n: number) => (n === 1 ? '1 aula chegando em breve' : `${n} aulas chegando em breve`),
  },

  panel: {
    title: 'Trilha guiada',
    text: 'Siga a ordem recomendada para dominar a ferramenta mais rápido. Nada é bloqueado.',
    progressLabel: (done: number, total: number) => `${done} de ${total} aulas concluídas`,
    ringAria: (percent: number) => `Progresso da trilha: ${percent}%`,
    allDone: 'Parabéns, você concluiu toda a trilha.',
  },

  search: {
    placeholder: 'Buscar aula: sessões, credencial, extensão…',
    aria: 'Buscar aulas',
    clear: 'Limpar busca',
    shortcut: 'Atalho: tecla /',
    count: (n: number) => (n === 1 ? '1 aula encontrada' : `${n} aulas encontradas`),
  },

  filters: {
    aria: 'Filtrar por estado',
    all: 'Todas',
    new: 'Para assistir',
    inProgress: 'Em andamento',
    done: 'Concluídas',
    allGroups: 'Todas as trilhas',
    groupsAria: 'Filtrar por trilha',
  },

  groups: {
    start: { title: 'Primeiros passos', hint: 'Conecte suas sessões e instale a extensão.' },
    credentials: { title: 'Credenciais de afiliado', hint: 'Conecte cada marketplace para gerar seus links.' },
    resources: { title: 'Recursos', hint: 'Use cada ferramenta do dia a dia.' },
  },

  card: {
    lesson: (n: string) => `Aula ${n}`,
    play: (title: string) => `Assistir: ${title}`,
    resume: (clock: string) => `Retomar em ${clock}`,
    watchedOf: (percent: number) => `${percent}% assistido`,
    soon: 'Em breve',
    watch: 'Assistir aula',
    watchResume: 'Retomar aula',
    rewatch: 'Rever aula',
    share: 'Copiar link da aula',
    shared: 'Link da aula copiado',
    shareFailed: 'Não foi possível copiar o link',
    soonHint: 'Esta aula está sendo gravada.',
    markDone: 'Marcar como concluída',
    markUndone: 'Desmarcar conclusão',
    status: { new: 'Nova', inProgress: 'Em andamento', done: 'Concluída' },
  },

  empty: {
    title: 'Nenhuma aula encontrada',
    text: 'Ajuste a busca ou os filtros para ver as demais aulas.',
    reset: 'Limpar filtros',
  },

  player: {
    stepOf: (step: number, total: number) => `${step} de ${total} aulas`,
    close: 'Fechar',
    prev: 'Aula anterior',
    next: 'Próxima aula',
    openYoutube: 'Abrir no YouTube',
    markDone: 'Marcar como concluída',
    markUndone: 'Desmarcar conclusão',
    doneToast: 'Aula concluída',
    resumeNote: (clock: string) => `Retomando de ${clock}`,
  },

  storageNote: 'Progresso salvo apenas neste navegador.',
  resetProgress: 'Zerar progresso',
  resetConfirm: {
    title: 'Zerar o progresso?',
    text: 'Todas as aulas voltam para "Nova". Isso só afeta este navegador.',
    confirm: 'Zerar',
    cancel: 'Cancelar',
  },

  lessons: {
    'connect-sessions': {
      title: 'Conectando sessões',
      description: 'Pareie seu WhatsApp por QR code ou código e deixe a sessão pronta para enviar.',
    },
    'install-desktop': {
      title: 'Instalando a extensão no computador',
      description: 'Instale a extensão no navegador e entre com a sua conta.',
    },
    'install-android': {
      title: 'Instalando a extensão no Android',
      description: 'Use a extensão no celular Android, passo a passo.',
    },
    'install-ios': {
      title: 'Instalando a extensão no iPhone',
      description: 'Configure a extensão no Safari do iPhone e deixe tudo pronto.',
    },
    'credential-mercado-livre': {
      title: 'Credencial do Mercado Livre',
      description: 'Conecte sua conta de afiliado do Mercado Livre e suas etiquetas.',
    },
    'credential-shein': {
      title: 'Credencial da Shein',
      description: 'Conecte sua conta de afiliado da Shein pela extensão.',
    },
    'credential-shopee': {
      title: 'Credencial da Shopee',
      description: 'Ative a API de afiliado da Shopee e salve suas chaves com segurança.',
    },
    'credential-amazon': {
      title: 'Credencial da Amazon',
      description: 'Informe seu ID de associado da Amazon para gerar links seus.',
    },
    monitoring: {
      title: 'Monitoramento',
      description: 'Acompanhe grupos e capture ofertas automaticamente.',
    },
    'offer-generator': {
      title: 'Gerador de ofertas',
      description: 'Crie e envie ofertas com o seu link de afiliado em poucos cliques.',
    },
    'link-manager': {
      title: 'Gestor de Links',
      description: 'Distribua novos membros entre seus grupos com um único link.',
    },
    storefront: {
      title: 'Página de Ofertas',
      description: 'Monte a vitrine pública com suas melhores ofertas.',
    },
    'offer-story': {
      title: 'Story de Oferta',
      description: 'Gere a arte vertical da oferta pronta para o Instagram.',
    },
  },
} as const;

export type LessonCopyId = keyof typeof tutorialsStrings.lessons;
