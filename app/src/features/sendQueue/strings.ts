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
  showAll: (n: number) => `Mostrar todos (${n})`,
  showLess: 'Mostrar menos',
  emptyWaiting: 'Nenhum envio aguardando nesta sessão.',
  emptyDone: 'Nenhum envio concluído hoje nesta sessão.',
};
