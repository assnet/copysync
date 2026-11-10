/** Rótulos do eixo de tempo das barras: funções puras, sem dependência da lib de gráficos. */
const MIN = 60_000;
const NICE_STEPS = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 4320].map((m) => m * MIN);

/** Hora local em ms (rótulos caem em hora cheia no fuso de quem vê). */
export function localMs(ms: number) {
  return ms - new Date(ms).getTimezoneOffset() * MIN;
}

/** Passo "redondo" (5 min … 1 dia) que dá no máximo `maxTicks` rótulos no período. */
export function barTickStep(times: number[], maxTicks: number) {
  const span = times.length > 1 ? times[times.length - 1] - times[0] : 0;
  return NICE_STEPS.find((s) => span / s <= maxTicks) ?? NICE_STEPS[NICE_STEPS.length - 1];
}

/**
 * Baldes que recebem rótulo: o primeiro de cada passo local. Não exige que o balde caia em hora
 * cheia (fusos +05:30/+09:30 com balde de 60 min nunca casariam igualdade exata).
 */
export function barTickSet(times: number[], tickMs: number): Set<number> {
  const out = new Set<number>();
  let prev: number | null = null;
  for (const ms of times) {
    const step = Math.floor(localMs(ms) / tickMs);
    if (step !== prev) out.add(ms);
    prev = step;
  }
  return out;
}
