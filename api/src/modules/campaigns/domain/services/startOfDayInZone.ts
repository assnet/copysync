/** Data/hora de parede no fuso, lida via `Intl`. */
function wallClock(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: n('year'), m: n('month'), d: n('day'), h: n('hour'), min: n('minute'), s: n('second') };
}

/** Deslocamento do fuso (ms) no instante dado: hora de parede − UTC. */
function offsetAt(at: Date, timeZone: string): number {
  const w = wallClock(at, timeZone);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Instante da meia-noite local de `now` no fuso — base do limite diário de ofertas.
 *
 * Sem lib de datas: lê o dia de parede, chuta a meia-noite pelo offset atual e
 * recalcula o offset nesse chute (cobre fuso com horário de verão).
 */
export function startOfDayInZone(now: Date, timeZone = 'America/Sao_Paulo'): Date {
  const { y, m, d } = wallClock(now, timeZone);
  const midnightAsUtc = Date.UTC(y, m - 1, d);
  let guess = midnightAsUtc - offsetAt(now, timeZone);
  guess = midnightAsUtc - offsetAt(new Date(guess), timeZone);
  return new Date(guess);
}
