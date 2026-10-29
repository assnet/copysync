/**
 * Textos da fila de envio, centralizados até o painel ter uma lib de i18n (mesmas regras de
 * `features/offers/strings.ts`): chaves semânticas, frase com variável é função, sem marca.
 */
import type { OfferOrigin } from '@/types/api.types';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const sendQueueStrings = {
  title: 'Fila de envio',
  subtitle: 'Um envio por vez em cada sessão. Continua no servidor mesmo com o navegador fechado.',
  refresh: 'Atualizar agora',
  loadError: 'Não foi possível carregar a fila.',
  retry: 'Tentar de novo',
  emptyTitle: 'Nada na fila agora',
  emptyDescription: 'Ofertas disparadas aparecem aqui, em qualquer aba ou navegador.',
  unnamedSession: 'Sessão sem nome',
  noSession: 'Envios antigos',
  sessionOffline: 'Sessão desconectada: a fila desta sessão espera ela voltar.',
  untitledGroup: 'Grupo sem nome',
  untitledOffer: 'Oferta sem título',
  sendingNow: 'Enviando agora',
  sendingNowAria: 'Envio em curso nesta sessão',
  nextSend: (group: string) => `Próximo · ${group}`,
  nextSendAria: 'Tempo até o próximo envio desta sessão',
  nextSendDone: 'Enviando…',
  nextSendHidden: 'Próximo envio',
  overdue: 'O próximo envio está atrasado: sai assim que a sessão estiver livre e conectada.',
  nextSendAt: (time: string) => `Previsto às ${time}`,
  remaining: (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
    return seconds >= 60 ? `${m}:${String(seconds % 60).padStart(2, '0')}` : `${seconds} s`;
  },
  tabs: {
    waiting: (n: number) => `Aguardando (${n})`,
    done: (n: number) => `Concluídos hoje (${n})`,
  },
  counts: {
    waiting: (n: number) => `${n} aguardando`,
    paused: (n: number) => `${n} ${plural(n, 'pausado', 'pausados')}`,
    sent: (n: number) => `${n} ${plural(n, 'enviado hoje', 'enviados hoje')}`,
    failed: (n: number) => `${n} ${plural(n, 'falha', 'falhas')}`,
    skipped: (n: number) => `${n} ${plural(n, 'pulado', 'pulados')}`,
  },
  countsTooltip: {
    waiting: 'Envios na fila desta sessão, na ordem em que vão sair',
    paused: 'Envios de ofertas pausadas: só saem quando você retomar',
    sent: 'Envios concluídos hoje nesta sessão',
    failed: 'Envios que falharam hoje (sessão caiu, grupo sumiu…)',
    skipped: 'Envios pulados hoje (oferta vencida, grupo removido…)',
  },
  at: (time: string) => `às ${time}`,
  paused: 'Pausado',
  waitingSession: 'Aguardando a sessão',
  waitingSessionTooltip: 'A sessão estava desconectada na vez deste envio. Ele volta para a fila e sai assim que ela reconectar (desiste após 6 h).',
  pausedTooltip: 'A oferta está pausada: este envio sai quando você retomar',
  finishedAt: (time: string) => `às ${time}`,
  origin: {
    GENERATOR: 'Gerador',
    MONITORING: 'Monitoramento',
  } satisfies Record<OfferOrigin, string>,
  originTooltip: {
    GENERATOR: 'Oferta criada no gerador de ofertas',
    MONITORING: 'Oferta capturada pelo monitoramento de grupos',
  } satisfies Record<OfferOrigin, string>,
  openOffer: 'Abrir oferta',
  control: {
    pause: 'Pausar oferta',
    resume: 'Retomar oferta',
    stop: 'Parar oferta',
    pauseTooltip: 'Segura os envios que faltam desta oferta em todos os grupos; o que está saindo termina.',
    resumeTooltip: 'Reagenda os envios que faltam desta oferta a partir de agora.',
    stopTooltip: 'Cancela os envios desta oferta que ainda não saíram, em todos os grupos. Não dá para desfazer.',
    scope: (waiting: number) => (waiting === 1 ? ' 1 envio aguardando.' : ` ${waiting} envios aguardando.`),
    /** Linha da fila que carrega os botões da oferta (as demais linhas da mesma oferta não repetem). */
    rowScope: (n: number) => (n === 1 ? 'esta oferta · 1 grupo' : `esta oferta · ${n} grupos`),
  },
  controlError: 'Não foi possível alterar a oferta. Atualize a fila e tente de novo.',
  /** Pausa global: todos os envios da conta, de todas as sessões e origens. */
  global: {
    pauseAll: 'Pausar todos os envios',
    resumeAll: 'Retomar envios',
    pauseAllTooltip: 'Segura TODOS os envios da conta, de todas as sessões e origens. A captura do monitoramento continua acumulando a fila. Dá para retomar a qualquer momento.',
    resumeAllTooltip: 'Os envios que já venceram o horário saem na ordem, espaçados, a partir de agora; horários futuros não mudam. Oferta que venceu a validade é ignorada.',
    pausedSince: (time: string) => `Envios pausados desde ${time}. Nenhum envio novo sai até você retomar (um que já estava saindo termina); o monitoramento continua capturando e colocando na fila.`,
    pausedChip: 'Pausado (conta)',
    pausedChipTooltip: 'Todos os envios da conta estão pausados: este sai quando você retomar.',
    error: 'Não foi possível alterar a pausa dos envios. Atualize a fila e tente de novo.',
  },
  stopConfirmTitle: 'Parar esta oferta?',
  stopConfirmDescription: 'Os envios que ainda não saíram serão cancelados em todos os grupos desta oferta. Os que já saíram ficam como estão. Não dá para desfazer.',
  stopConfirm: 'Parar oferta',
  stopCancel: 'Voltar',
  showAll: (n: number) => `Mostrar todos (${n})`,
  showLess: 'Mostrar menos',
  emptyWaiting: 'Nenhum envio aguardando nesta sessão.',
  emptyDone: 'Nenhum envio concluído hoje nesta sessão.',
};
