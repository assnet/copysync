import type { WorkerScaleEvent } from '../../domain/contracts/IWorkerScaleEventRepository';
import type { WorkerScalerState } from '../../domain/contracts/IWorkerScaler';
import type { WorkerScaleStateView } from '../../application/use-cases/GetWorkerScaleStateUseCase';

/**
 * Evento sem identificar o ator (WSCALE-13: quem pediu fica na auditoria) e sem `requestId`.
 * Lista explícita de campos: coluna nova no evento não vaza sem passar por aqui.
 */
export function presentWorkerScaleEvent(e: WorkerScaleEvent) {
  return {
    id: e.id,
    at: e.at.toISOString(),
    trigger: e.trigger,
    fromReplicas: e.fromReplicas,
    toReplicas: e.toReplicas,
    reason: e.reason,
    outcome: e.outcome,
    error: e.error,
  };
}

/** Só os campos do contrato da porta (nunca chave nem id do serviço). */
function presentScalerState(s: WorkerScalerState) {
  switch (s.status) {
    case 'ready':
      return {
        status: s.status,
        desiredReplicas: s.desiredReplicas,
        runningReplicas: s.runningReplicas,
        hasDisk: s.hasDisk,
        autoscalingEnabled: s.autoscalingEnabled,
      };
    case 'not_configured':
      return { status: s.status, missing: [...s.missing] };
    case 'unavailable':
      return { status: s.status, reason: s.reason };
  }
}

export function presentWorkerScaleState(v: WorkerScaleStateView) {
  return {
    scaler: presentScalerState(v.scaler),
    settings: v.settings,
    cooldownUntil: v.cooldownUntil ? v.cooldownUntil.toISOString() : null,
    lastEvent: v.lastEvent ? presentWorkerScaleEvent(v.lastEvent) : null,
    lastAutoEvent: v.lastAutoEvent ? presentWorkerScaleEvent(v.lastAutoEvent) : null,
    enforced: v.enforced,
  };
}
