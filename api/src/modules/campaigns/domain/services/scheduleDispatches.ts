/** Intervalo entre envios a destinos diferentes (ms). */
export interface DispatchInterval {
  minMs: number;
  maxMs: number;
}

/** 8–15 s: espaçamento aleatório para não parecer disparo em massa. */
export const DEFAULT_DISPATCH_INTERVAL: DispatchInterval = { minMs: 8000, maxMs: 15000 };

/**
 * Horário mínimo (`notBefore`) de cada envio. O primeiro é imediato; cada seguinte
 * soma um intervalo sorteado em `[minMs, maxMs]`. `rand` injetável para teste.
 */
export function scheduleDispatches(
  count: number,
  now: Date,
  interval: DispatchInterval = DEFAULT_DISPATCH_INTERVAL,
  rand: () => number = Math.random,
): Date[] {
  const slots: Date[] = [];
  let at = now.getTime();
  for (let i = 0; i < count; i++) {
    if (i > 0) at += Math.round(interval.minMs + rand() * (interval.maxMs - interval.minMs));
    slots.push(new Date(at));
  }
  return slots;
}
