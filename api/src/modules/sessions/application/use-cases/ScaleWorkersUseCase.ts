import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { AppError } from '../../../../shared/errors/AppError';
import {
  AdoptionDisabledError,
  ScaleCooldownActiveError,
  ScaleDownWouldExceedCapacityError,
  ScalerModeOffError,
  ScalerNotConfiguredError,
  ScalerRateLimitedError,
  ScalerServiceNotScalableError,
  ScalerUnavailableError,
  ScaleTargetOutOfRangeError,
  ScaleTargetUnchangedError,
} from '../../../../shared/errors/internal/WorkerScalingErrors';
import type {
  IWorkerScaleEventRepository,
  WorkerScaleEvent,
  WorkerScaleTrigger,
} from '../../domain/contracts/IWorkerScaleEventRepository';
import type { IWorkerScaler } from '../../domain/contracts/IWorkerScaler';
import type { IWorkerScalingSettingsProvider } from '../../domain/contracts/IWorkerScalingSettingsProvider';
import { canScaleDownTo } from '../../domain/services/capacityPlan';

export interface ScaleWorkersInput {
  /** Réplicas alvo. */
  replicas: number;
  /** Motivo (obrigatório no manual; a rota valida tamanho/vazio, o repositório trunca em 200). */
  reason: string;
  /** Idempotência: o mesmo id devolve o evento anterior sem chamar de novo. `null` no job. */
  requestId: string | null;
  trigger: WorkerScaleTrigger;
  /** Super admin que pediu; `null` = sistema (job). Auditoria só quando há ator. */
  actorUserId: string | null;
  /**
   * Sessões conectadas agora, contadas por quem chama (rota: leitor de capacidade; job: amostra
   * `sessions_connected`). O use case não consulta sessões: só aplica a regra de redução.
   */
  connected: number;
}

export interface ScaleWorkersResult {
  event: WorkerScaleEvent;
  /** `true` quando o `requestId` já tinha sido visto e nada foi chamado. */
  replayed: boolean;
}

export interface ScaleWorkersDeps {
  events: IWorkerScaleEventRepository;
  scaler: IWorkerScaler;
  settings: IWorkerScalingSettingsProvider;
  audit: IAuditLogRepository;
  /** Lido a cada pedido (`workerAdoptionConfig().enabled`). */
  isAdoptionEnabled: () => boolean;
  now?: () => Date;
}

/** Réplicas atuais desconhecidas (recusa antes de ler o escalador): `fromReplicas` gravado como 0. */
const UNKNOWN_REPLICAS = 0;

class ScaleRejection {
  constructor(
    readonly error: AppError,
    readonly fromReplicas: number,
  ) {}
}

/**
 * Pedido de escala das réplicas do worker (WSCALE-12/13). Regras, em ordem: modo `off`, adoção
 * desligada, faixa `[min, max]`, estado do escalador, passo do automático (+1), intervalo mínimo,
 * capacidade na redução, alvo igual ao atual. Cada recusa grava evento `rejected` e lança.
 * Aceito: grava `requested` ANTES da chamada externa (queda no meio deixa rastro e o intervalo
 * conta do pedido), chama `scaleTo` (sem retry) e atualiza para `succeeded` ou `failed`.
 */
export class ScaleWorkersUseCase {
  private readonly now: () => Date;

  constructor(private readonly deps: ScaleWorkersDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Mesmas regras de `execute`, sem gravar nada e sem chamar `scaleTo` (job automático). */
  async checkPreconditions(input: ScaleWorkersInput): Promise<{ fromReplicas: number }> {
    const outcome = await this.evaluate(input);
    if (outcome instanceof ScaleRejection) throw outcome.error;
    return outcome;
  }

  async execute(input: ScaleWorkersInput): Promise<ScaleWorkersResult> {
    if (input.requestId) {
      const previous = await this.deps.events.findByRequestId(input.requestId);
      if (previous) return { event: previous, replayed: true };
    }

    const outcome = await this.evaluate(input);
    if (outcome instanceof ScaleRejection) {
      // Recusa sem `requestId`: o mesmo pedido pode ser refeito depois (fim do intervalo etc.).
      await this.deps.events.record({
        ...this.base(input, outcome.fromReplicas),
        outcome: 'rejected',
        error: outcome.error.code,
        requestId: null,
      });
      throw outcome.error;
    }

    const at = this.now();
    const base = this.base(input, outcome.fromReplicas);
    let id: number;
    try {
      id = await this.deps.events.record({ ...base, outcome: 'requested', error: null, requestId: input.requestId });
    } catch (err) {
      // Corrida com o mesmo `requestId`: a unicidade barrou o segundo; devolve o primeiro.
      const winner = input.requestId ? await this.deps.events.findByRequestId(input.requestId) : null;
      if (winner) return { event: winner, replayed: true };
      throw err;
    }
    const event: WorkerScaleEvent = { id, at, ...base, outcome: 'requested', error: null, requestId: input.requestId };

    try {
      await this.deps.scaler.scaleTo(input.replicas);
    } catch (err) {
      const error = shortError(err);
      await this.deps.events.updateOutcome(id, 'failed', error);
      await this.auditRequest(input, { ...event, outcome: 'failed', error });
      throw err;
    }
    await this.deps.events.updateOutcome(id, 'succeeded', null);
    const done: WorkerScaleEvent = { ...event, outcome: 'succeeded' };
    await this.auditRequest(input, done);
    return { event: done, replayed: false };
  }

  private async evaluate(input: ScaleWorkersInput): Promise<ScaleRejection | { fromReplicas: number }> {
    const settings = this.deps.settings.current().value;
    const unknown = (error: AppError) => new ScaleRejection(error, UNKNOWN_REPLICAS);

    if (settings.scalerMode === 'off') return unknown(new ScalerModeOffError());
    if (!this.deps.isAdoptionEnabled()) return unknown(new AdoptionDisabledError());
    if (!Number.isInteger(input.replicas) || input.replicas < settings.minReplicas || input.replicas > settings.maxReplicas) {
      return unknown(new ScaleTargetOutOfRangeError(settings.minReplicas, settings.maxReplicas));
    }

    const state = await this.deps.scaler.getState();
    if (state.status === 'not_configured') return unknown(new ScalerNotConfiguredError(state.missing));
    if (state.status === 'unavailable') {
      return unknown(
        state.reason === 'rate_limited' ? new ScalerRateLimitedError(null) : new ScalerUnavailableError(state.reason),
      );
    }
    const current = state.desiredReplicas;
    const reject = (error: AppError) => new ScaleRejection(error, current);
    if (state.hasDisk) return reject(new ScalerServiceNotScalableError('disk'));
    if (state.autoscalingEnabled) return reject(new ScalerServiceNotScalableError('native_autoscaling'));

    // Automático só sobe uma réplica por decisão (design §7).
    if (input.trigger === 'auto' && input.replicas !== current + 1) {
      return reject(new ScaleTargetOutOfRangeError(current + 1, current + 1));
    }

    const last = await this.deps.events.lastSucceededAt();
    if (last) {
      const retryAt = new Date(last.getTime() + settings.scaleCooldownSeconds * 1000);
      if (retryAt.getTime() > this.now().getTime()) return reject(new ScaleCooldownActiveError(retryAt));
    }

    if (input.replicas < current) {
      const { maxSessionsPerWorker, alertOccupancyRatio: ratio } = settings;
      if (!canScaleDownTo(input.replicas, maxSessionsPerWorker, ratio, input.connected)) {
        return reject(
          new ScaleDownWouldExceedCapacityError({
            replicas: input.replicas,
            maxSessionsPerWorker,
            ratio,
            connected: input.connected,
            capacity: Math.floor(input.replicas * maxSessionsPerWorker * ratio),
          }),
        );
      }
    }

    if (input.replicas === current) return reject(new ScaleTargetUnchangedError(current));
    return { fromReplicas: current };
  }

  private base(input: ScaleWorkersInput, fromReplicas: number) {
    return {
      trigger: input.trigger,
      actorUserId: input.actorUserId,
      fromReplicas,
      toReplicas: input.replicas,
      reason: input.reason,
    };
  }

  private async auditRequest(input: ScaleWorkersInput, event: WorkerScaleEvent): Promise<void> {
    if (!input.actorUserId) return;
    await this.deps.audit.create({
      userId: input.actorUserId,
      action: 'WORKER_SCALE_REQUESTED',
      meta: {
        eventId: event.id,
        fromReplicas: event.fromReplicas,
        toReplicas: event.toReplicas,
        reason: event.reason,
        outcome: event.outcome,
        error: event.error,
        requestId: event.requestId,
      },
    });
  }
}

/** Código interno do erro (sem mensagem do provedor, chave nem id do serviço). */
function shortError(err: unknown): string {
  if (err instanceof AppError) {
    const reason = typeof err.meta?.reason === 'string' ? `:${err.meta.reason}` : '';
    return `${err.code}${reason}`;
  }
  return 'SCALE_REQUEST_FAILED';
}
