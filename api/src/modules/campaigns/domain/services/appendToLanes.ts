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

/**
 * Fim do bloco ocupado da faixa a partir de `from`: percorre os envios abertos em ordem e estende o
 * fim enquanto o próximo começa até `maxGapMs` depois do fim corrente. Um buraco maior deixa a faixa
 * livre no meio (ex.: captura do monitoramento jogada para a abertura da janela de amanhã não
 * prende o gerador de agora). null = nada ocupado a partir de `from`.
 */
export function laneBusyUntil(open: readonly Date[], from: Date, maxGapMs: number): Date | null {
  const sorted = [...open].map((d) => d.getTime()).sort((a, b) => a - b);
  let end: number | null = null;
  for (const t of sorted) {
    // Envio que começa até `maxGapMs` depois do fim corrente (ou de `from`) faz parte do bloco
    if (t > (end ?? from.getTime()) + maxGapMs) break;
    end = Math.max(end ?? from.getTime(), t);
  }
  return end === null ? null : new Date(end);
}

/** Fim da faixa de cada sessão a partir de `from`, com `laneBusyUntil`. Sessão livre não entra no mapa. */
export function laneTailsFromOpen(openBySession: ReadonlyMap<string, readonly Date[]>, from: Date, maxGapMs: number): Map<string, Date> {
  const out = new Map<string, Date>();
  for (const [sessionId, open] of openBySession) {
    const end = laneBusyUntil(open, from, maxGapMs);
    if (end) out.set(sessionId, end);
  }
  return out;
}
