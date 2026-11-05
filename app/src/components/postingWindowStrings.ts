/**
 * Textos do `PostingWindowField` (horário de postagem: faixa do dia + dias da semana).
 * Compartilhado pelo monitoramento e pelo gerador de ofertas — sem termo de um produto só.
 */

/** Duração legível: `45 min`, `8 h`, `8 h 30 min`. */
function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/** Índice = dia da semana (0 = domingo), igual ao bit do `weekdaysMask`. */
const DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DAY_FULL = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

export const postingWindowStrings = {
  formatDuration,
  sliderAria: 'Horário de postagem',
  start: 'Início',
  end: 'Fim',
  fullDay: 'Dia inteiro — 24 h',
  range: (start: string, end: string, duration: string) => `${start} → ${end} · ${duration}`,
  rangeAria: (start: string, end: string, duration: string) => `Postagens entre ${start} e ${end}, ${duration} por dia`,
  helpShort: 'Fora do horário a oferta espera e sai quando ele abrir de novo.',
  help: 'Vale para toda postagem, não só a primeira: fora do horário ou num dia desmarcado a oferta espera na fila e sai na próxima abertura. Oferta que vencer esperando é ignorada. Horário de Brasília, passo de 15 minutos. A janela noturna pertence ao dia em que começa.',
  helpAria: 'Como funciona o horário de postagem',
  overnight: 'Janela noturna (cruza a meia-noite)',
  overnightHelp: 'Posta fora da faixa marcada: do cursor da direita, passando pela meia-noite, até o da esquerda.',
  empty: 'A janela noturna precisa deixar algum horário livre. Afaste os cursores das pontas.',
  daysLabel: 'Dias da semana',
  daysAria: 'Dias da semana com postagem',
  dayShort: (day: number) => DAY_SHORT[day] ?? '',
  dayFull: (day: number) => DAY_FULL[day] ?? '',
  dayLastTooltip: 'Deixe ao menos um dia marcado',
  daysAll: 'Todos os dias',
  daysWeek: 'Segunda a sexta',
  daysWeekend: 'Fim de semana',
  daysList: (days: number[]) => days.map((d) => DAY_SHORT[d]).join(', '),
};
