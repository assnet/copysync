import type { DispatchInterval } from './scheduleDispatches';

export interface LaneSlot {
  sessionId: string;
  notBefore: Date;
}

/** Folga sorteada entre o fim de uma faixa e o próximo envio, dentro do intervalo configurado. */
export function laneGapMs(interval: DispatchInterval, rand: () => number = Math.random): number {
  return Math.round(interval.minMs + rand() * (interval.maxMs - interval.minMs));
}

/**
 * Encosta a agenda de uma oferta no fim das faixas de envio (uma por sessão). Desloca TODOS os
 * horários pelo mesmo tanto, o menor que deixa o primeiro envio de cada sessão pelo menos `gapMs`
 * depois do fim da faixa dela: a ordem e o espaçamento internos da oferta não mudam. Sem nada à
 * frente, devolve os horários como vieram.
 *
 * A garantia de série por sessão é do claim do worker; isto só deixa o horário previsto honesto.
 */
export function appendToLanes(slots: readonly LaneSlot[], tails: ReadonlyMap<string, Date>, gapMs: number): Date[] {
  const firstBySession = new Map<string, number>();
  for (const s of slots) {
    const t = s.notBefore.getTime();
    const prev = firstBySession.get(s.sessionId);
    if (prev === undefined || t < prev) firstBySession.set(s.sessionId, t);
  }
  let offset = 0;
  for (const [sessionId, first] of firstBySession) {
    const tail = tails.get(sessionId);
    if (tail) offset = Math.max(offset, tail.getTime() + gapMs - first);
  }
  return slots.map((s) => new Date(s.notBefore.getTime() + offset));
}
