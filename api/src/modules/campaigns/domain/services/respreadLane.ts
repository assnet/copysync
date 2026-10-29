import { laneGapMs } from './appendToLanes';
import type { LaneEntry } from './compactLane';
import type { DispatchInterval } from './scheduleDispatches';

export interface RespreadLaneOptions {
  now: Date;
  /** Início do último envio da sessão (em curso ou concluído); null = nada saiu ainda. */
  lastClaimedAt: Date | null;
  interval: DispatchInterval;
  rand?: () => number;
}

/**
 * Retomada global: a fila da sessão ficou parada e muitos horários venceram. Reespalha a partir de
 * agora, na mesma ordem: o primeiro sai agora (ou uma folga depois do último envio, se foi há pouco;
 * ou no horário marcado, se ainda é futuro); cada seguinte mantém o espaçamento original, nunca
 * menor que o mínimo (sem rajada na prévia) nem maior que o máximo (buracos viram uma folga).
 * Devolve só o que muda. A cadência real continua garantida pelo claim do worker.
 */
export function respreadLane(entries: readonly LaneEntry[], opts: RespreadLaneOptions): LaneEntry[] {
  if (entries.length === 0) return [];
  const rand = opts.rand ?? Math.random;
  const sorted = [...entries].sort((a, b) => a.notBefore.getTime() - b.notBefore.getTime());
  const nowMs = opts.now.getTime();
  const floor = opts.lastClaimedAt ? Math.max(nowMs, opts.lastClaimedAt.getTime() + laneGapMs(opts.interval, rand)) : nowMs;
  const first = sorted[0]!.notBefore.getTime();
  const times: number[] = [first < nowMs ? floor : Math.max(first, floor)];
  for (let i = 1; i < sorted.length; i++) {
    const delta = sorted[i]!.notBefore.getTime() - sorted[i - 1]!.notBefore.getTime();
    const step = delta > opts.interval.maxMs ? laneGapMs(opts.interval, rand) : Math.max(delta, opts.interval.minMs);
    times.push(times[i - 1]! + step);
  }
  return sorted
    .map((e, i) => ({ id: e.id, notBefore: new Date(times[i]!) }))
    .filter((e, i) => e.notBefore.getTime() !== sorted[i]!.notBefore.getTime());
}
