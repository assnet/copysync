/**
 * Contas de capacidade e regras de escala dos workers (WSCALE-09/12/15/16).
 * Funções puras: sem I/O, sem env e sem relógio próprio (o instante chega como `now`).
 * Conversão de unidade e escolha do recurso ficam na T16; a contagem de aguardando, na T27.
 * Ver `.specs/features/worker-scaling/design.md` §6.
 */
import type { WorkerScalingSettings } from './workerScalingSettings';

/** Fração do limite de RAM usada para sugerir o teto (folga de 30% para pico e GC). */
export const SUGGESTED_MEMORY_FRACTION = 0.7;

/** Resolução das amostras `sessions_*`: média de 5 min (`OPS_PERSIST_EVERY_TICKS = 5`). */
export const OCCUPANCY_SAMPLE_SECONDS = 300;

/**
 * "Amostra recente": a última amostra tem até 10 min antes de `now` (duas resoluções de 5 min).
 * Mais velha que isso = coletor parado; o job não age (`no_samples`).
 */
export const OCCUPANCY_SAMPLE_MAX_AGE_MS = 10 * 60 * 1000;

function isPositiveFinite(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** Réplicas necessárias: `ceil(connected ÷ (teto × ratio))`, mínimo 1. Entrada inválida → 1. */
export function requiredReplicas(connected: number, maxSessionsPerWorker: number, ratio: number): number {
  const perReplica = maxSessionsPerWorker * ratio;
  if (!isPositiveFinite(perReplica) || !isPositiveFinite(connected)) return 1;
  return Math.max(1, Math.ceil(connected / perReplica));
}

/** MB por sessão = média de memória (MB) ÷ média de conectadas. Falta dado ou conectadas ≤ 0 → `null`. */
export function mbPerSession(avgMemoryMb: number | null, avgConnected: number | null): number | null {
  if (!isPositiveFinite(avgMemoryMb) || !isPositiveFinite(avgConnected)) return null;
  return avgMemoryMb / avgConnected;
}

/** Teto sugerido = `floor(0,7 × limite ÷ MB por sessão)`. Sem limite ou sem MB por sessão → `null`. */
export function suggestedMaxSessions(memoryLimitMb: number | null, mbPerSessionValue: number | null): number | null {
  if (!isPositiveFinite(memoryLimitMb) || !isPositiveFinite(mbPerSessionValue)) return null;
  return Math.floor((SUGGESTED_MEMORY_FRACTION * memoryLimitMb) / mbPerSessionValue);
}

/** Redução permitida só se `replicas × teto × ratio ≥ conectadas` (WSCALE-12). */
export function canScaleDownTo(
  replicas: number,
  maxSessionsPerWorker: number,
  ratio: number,
  connected: number,
): boolean {
  return replicas * maxSessionsPerWorker * ratio >= connected;
}

export interface OccupancySample {
  at: Date;
  connected: number;
  capacity: number;
}

export type ScaleUpReason = 'occupancy' | 'awaiting' | 'no_samples';

export interface ShouldScaleUpInput {
  /** Amostras `sessions_*` do banco (WSCALE-16), em qualquer ordem. */
  occupancySamples: readonly OccupancySample[];
  /** Sessões aguardando capacidade há mais de `awaitingAlertSeconds` (contadas ao vivo no banco). */
  awaitingOlderThanThreshold: number;
  settings: Pick<WorkerScalingSettings, 'alertOccupancyRatio' | 'scaleUpSustainSeconds'>;
  now: Date;
}

export interface ShouldScaleUpResult {
  /** `null` quando não há aguardando nem amostra recente: o job não decide. */
  scaleUp: boolean | null;
  reason: ScaleUpReason | null;
}

function isAboveRatio(sample: OccupancySample, ratio: number): boolean {
  // Mesmo critério de `sessionAdoptionPolicy`: estritamente acima, capacidade > 0.
  return sample.capacity > 0 && sample.connected / sample.capacity > ratio;
}

/**
 * Decide subir uma réplica (WSCALE-15). Primeiro o gatilho de aguardando: contado ao vivo no banco (T27),
 * vale mesmo sem amostra → `awaiting`. Depois as amostras: sem amostra recente → `{ scaleUp: null, reason: 'no_samples' }`.
 * Ocupação sustentada = todas as amostras em `(now − scaleUpSustainSeconds, now]` acima de
 * `alertOccupancyRatio` e pelo menos `ceil(scaleUpSustainSeconds ÷ 300)` delas. Amostras futuras são ignoradas.
 */
export function shouldScaleUp(input: ShouldScaleUpInput): ShouldScaleUpResult {
  if (input.awaitingOlderThanThreshold > 0) return { scaleUp: true, reason: 'awaiting' };

  const nowMs = input.now.getTime();
  const past = input.occupancySamples.filter((s) => s.at.getTime() <= nowMs);
  const latestMs = past.reduce((max, s) => Math.max(max, s.at.getTime()), -Infinity);
  if (past.length === 0 || nowMs - latestMs > OCCUPANCY_SAMPLE_MAX_AGE_MS) {
    return { scaleUp: null, reason: 'no_samples' };
  }

  const { alertOccupancyRatio, scaleUpSustainSeconds } = input.settings;
  const windowStartMs = nowMs - scaleUpSustainSeconds * 1000;
  const inWindow = past.filter((s) => s.at.getTime() > windowStartMs);
  const minSamples = Math.ceil(scaleUpSustainSeconds / OCCUPANCY_SAMPLE_SECONDS);
  if (inWindow.length >= minSamples && inWindow.every((s) => isAboveRatio(s, alertOccupancyRatio))) {
    return { scaleUp: true, reason: 'occupancy' };
  }
  return { scaleUp: false, reason: null };
}
