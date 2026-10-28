import { laneGapMs } from './appendToLanes';
import type { DispatchInterval } from './scheduleDispatches';

export interface LaneEntry {
  id: string;
  notBefore: Date;
}

export interface CompactLaneOptions {
  now: Date;
  /** Início do último envio da sessão (em curso ou concluído); null = nada saiu ainda. */
  lastClaimedAt: Date | null;
  interval: DispatchInterval;
  rand?: () => number;
}

/**
 * Pausar ou parar uma oferta abre um buraco na faixa da sessão: as ofertas seguintes ficavam com os
 * horários lá na frente. Esta regra puxa o que sobrou: o primeiro envio vai para logo depois de uma
 * folga sorteada desde o último envio da sessão (nunca antes do que já estava marcado, nunca para o
 * passado) e cada espaço maior que o intervalo máximo vira uma folga sorteada. Ordem e espaçamentos
 * já dentro do intervalo não mudam. Sessão que ainda não enviou nada mantém o primeiro horário (pode
 * ser um "esperar para começar" legítimo); só os buracos internos fecham. Devolve só o que muda.
 */
export function compactLane(entries: readonly LaneEntry[], opts: CompactLaneOptions): LaneEntry[] {
  if (entries.length === 0) return [];
  const rand = opts.rand ?? Math.random;
  const sorted = [...entries].sort((a, b) => a.notBefore.getTime() - b.notBefore.getTime());
  const nowMs = opts.now.getTime();
  const first = sorted[0]!.notBefore.getTime();
  const times: number[] = [];
  if (opts.lastClaimedAt) {
    const floor = opts.lastClaimedAt.getTime() + laneGapMs(opts.interval, rand);
    times.push(Math.min(first, Math.max(floor, nowMs)));
  } else {
    times.push(first);
  }
  for (let i = 1; i < sorted.length; i++) {
    const delta = sorted[i]!.notBefore.getTime() - sorted[i - 1]!.notBefore.getTime();
    times.push(times[i - 1]! + (delta > opts.interval.maxMs ? laneGapMs(opts.interval, rand) : delta));
  }
  return sorted
    .map((e, i) => ({ id: e.id, notBefore: new Date(times[i]!) }))
    .filter((e, i) => e.notBefore.getTime() !== sorted[i]!.notBefore.getTime());
}
