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

/**
 * Dispara o contador sem segurar quem chama (fail-open): não espera a promessa e engole erro síncrono ou
 * assíncrono, entregando-o a `onError` (log). Contador lento ou quebrado não muda resultado nem tempo do envio.
 */
export function recordFeatureUsage(
  recorder: IFeatureUsageRecorder | null | undefined,
  event: FeatureUsageEvent,
  onError: (err: unknown) => void,
  op: 'increment' | 'markOnce' = 'increment',
): void {
  if (!recorder) return;
  try {
    recorder[op](event).catch((err: unknown) => {
      try {
        onError(err);
      } catch {
        /* log não derruba o envio */
      }
    });
  } catch (err) {
    try {
      onError(err);
    } catch {
      /* idem */
    }
  }
}
