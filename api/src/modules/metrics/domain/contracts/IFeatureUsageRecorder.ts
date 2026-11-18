import type { FeatureUsageKind } from '../services/featureUsageCatalog';

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

let pending = 0;
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
 * uma vez por minuto (amostrado, com quantos caíram).
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
