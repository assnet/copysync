import type { FeatureUsageKind } from '../services/featureUsageCatalog';
import { dayInZone } from '../services/featureUsagePeriod';

/** Um uso: só conta, chave, tipo e instante (nada de usuário, conteúdo ou destino). */
export interface FeatureUsageEvent {
  tenantId: string;
  featureKey: string;
  kind: FeatureUsageKind;
  /** Instante do uso; o dia gravado é o de Brasília (`dayInZone(at)`), nunca o dia UTC. */
  at: Date;
}

/**
 * Contador de uso (design §4.5). Quem chama não espera nem trata o resultado: usar `recordFeatureUsage`
 * (sem `await`, falha vira log). A implementação ignora chamada antes da data de corte do recurso.
 */
export interface IFeatureUsageRecorder {
  /** +1 no dia × conta × recurso × tipo. */
  increment(event: FeatureUsageEvent): Promise<void>;
  /** No máximo 1 por dia × conta × recurso × tipo (visita de tela, P3). */
  markOnce(event: FeatureUsageEvent): Promise<void>;
}

/** Teto de gravações do contador em voo por processo; acima, o uso é descartado (banco lento não acumula promessas). */
export const FEATURE_USAGE_MAX_PENDING = 20;
/** Aviso de descarte amostrado: no máximo um a cada minuto por processo, com a contagem acumulada. */
export const FEATURE_USAGE_DROP_LOG_EVERY_MS = 60_000;

/** Usos descartados pelo teto desde o último aviso (vai a `onError`, que loga `warn`). */
export class FeatureUsageDroppedError extends Error {
  constructor(readonly dropped: number) {
    super(`feature usage dropped: ${dropped} above ${FEATURE_USAGE_MAX_PENDING} pending`);
    this.name = 'FeatureUsageDroppedError';
  }
}

/** Descartes por dia (Brasília) × recurso: `{ "YYYY-MM-DD": { "<featureKey>": n } }`. */
export type FeatureUsageDropCounts = Record<string, Record<string, number>>;
/** Grava (soma) os descartes; implementação na infra (`platform_settings["feature_usage_dropped"]`). */
export type FeatureUsageDropSink = (counts: FeatureUsageDropCounts) => Promise<void>;
/** No máximo uma gravação de descartes por minuto por processo (lote amostrado). */
export const FEATURE_USAGE_DROP_FLUSH_EVERY_MS = 60_000;

let pending = 0;
let dropSink: FeatureUsageDropSink | null = null;
let dropBuffer: FeatureUsageDropCounts = {};
let lastDropFlushAt = Number.NEGATIVE_INFINITY;
let dropFlushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Liga a gravação dos descartes (o container do contador chama uma vez). Sem destino, o descarte só vai ao log.
 * `null` desliga e zera o lote (teste).
 */
export function setFeatureUsageDropSink(sink: FeatureUsageDropSink | null): void {
  dropSink = sink;
  if (!sink) {
    dropBuffer = {};
    lastDropFlushAt = Number.NEGATIVE_INFINITY;
    if (dropFlushTimer) clearTimeout(dropFlushTimer);
    dropFlushTimer = null;
  }
}

function addDrops(into: FeatureUsageDropCounts, from: FeatureUsageDropCounts): void {
  for (const [day, keys] of Object.entries(from)) {
    const d = (into[day] ??= {});
    for (const [key, n] of Object.entries(keys)) d[key] = (d[key] ?? 0) + n;
  }
}

function scheduleDropFlush(): void {
  if (!dropSink || dropFlushTimer) return;
  const wait = Math.max(0, lastDropFlushAt + FEATURE_USAGE_DROP_FLUSH_EVERY_MS - Date.now());
  dropFlushTimer = setTimeout(() => void flushFeatureUsageDrops(), wait);
  dropFlushTimer.unref?.();
}

/**
 * Grava o lote de descartes acumulado (uma instrução). Fail-open: falha devolve o lote ao acúmulo e tenta de novo
 * no minuto seguinte; nunca lança.
 */
export async function flushFeatureUsageDrops(): Promise<void> {
  if (dropFlushTimer) clearTimeout(dropFlushTimer);
  dropFlushTimer = null;
  const sink = dropSink;
  const counts = dropBuffer;
  if (!sink || Object.keys(counts).length === 0) return;
  dropBuffer = {};
  lastDropFlushAt = Date.now();
  try {
    await sink(counts);
  } catch {
    addDrops(dropBuffer, counts);
    scheduleDropFlush();
  }
}

function noteDrop(event: FeatureUsageEvent): void {
  if (!dropSink) return;
  let day: string;
  try {
    day = dayInZone(event.at);
  } catch {
    return;
  }
  addDrops(dropBuffer, { [day]: { [event.featureKey]: 1 } });
  scheduleDropFlush();
}
let droppedSinceLog = 0;
let lastDropLogAt = Number.NEGATIVE_INFINITY;

/** Gravações em voo agora (teste e diagnóstico). */
export function featureUsagePending(): number {
  return pending;
}

/**
 * Dispara o contador sem segurar quem chama (fail-open): não espera a promessa e engole erro síncrono ou
 * assíncrono, entregando-o a `onError` (log). Contador lento ou quebrado não muda resultado nem tempo do envio.
 * Com 20 gravações em voo no processo, descarta o uso e avisa `onError` com `FeatureUsageDroppedError` no máximo
 * uma vez por minuto (amostrado, com quantos caíram). O descarte é somado por dia × recurso e gravado em lote no
 * máximo 1×/min (`setFeatureUsageDropSink`): a leitura mostra o motivo de cobertura `DROPPED` no período.
 */
export function recordFeatureUsage(
  recorder: IFeatureUsageRecorder | null | undefined,
  event: FeatureUsageEvent,
  onError: (err: unknown) => void,
  op: 'increment' | 'markOnce' = 'increment',
): void {
  if (!recorder) return;
  const report = (err: unknown) => {
    try {
      onError(err);
    } catch {
      /* log não derruba o envio */
    }
  };
  if (pending >= FEATURE_USAGE_MAX_PENDING) {
    droppedSinceLog++;
    noteDrop(event);
    const now = Date.now();
    if (now - lastDropLogAt >= FEATURE_USAGE_DROP_LOG_EVERY_MS) {
      lastDropLogAt = now;
      const dropped = droppedSinceLog;
      droppedSinceLog = 0;
      report(new FeatureUsageDroppedError(dropped));
    }
    return;
  }
  pending++;
  try {
    recorder[op](event)
      .catch(report)
      .finally(() => {
        pending--;
      });
  } catch (err) {
    pending--;
    report(err);
  }
}
