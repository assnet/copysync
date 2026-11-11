/** Envs que ligam o escalador (WSCALE-11). `missing` lista só os nomes, nunca valores. */
export type WorkerScalerConfigKey = 'WORKER_SCALER_ENABLED' | 'RENDER_API_KEY' | 'WORKER_SCALER_SERVICE_ID';

/** Por que o provedor não respondeu. Nunca carrega chave, id do serviço nem corpo da resposta. */
export type WorkerScalerFailureReason = 'auth' | 'not_found' | 'rate_limited' | 'upstream' | 'timeout';

export type WorkerScalerState =
  | {
      status: 'ready';
      /** Réplicas pedidas ao provedor (o alvo). */
      desiredReplicas: number;
      /** Instâncias rodando agora. */
      runningReplicas: number;
      /** Serviço com disco não escala (`scaleTo` recusa). */
      hasDisk: boolean;
      /** Autoescala nativa do provedor ligada: `scaleTo` recusa para não brigar com ela. */
      autoscalingEnabled: boolean;
    }
  | { status: 'not_configured'; missing: WorkerScalerConfigKey[] }
  | {
      status: 'unavailable';
      reason: WorkerScalerFailureReason;
      /** Só com `rate_limited`: segundos do `Retry-After` do provedor (`null` se ausente). */
      retryAfterSeconds?: number | null;
    };

/**
 * Escalador das réplicas do serviço worker (WSCALE-11). Sem regra de produto: intervalo mínimo,
 * faixa min/max e capacidade ficam no use case. Sem retry automático.
 */
export interface IWorkerScaler {
  /** Estado ao vivo. Não lança: falha do provedor vira `unavailable`. */
  getState(): Promise<WorkerScalerState>;
  /**
   * Pede `replicas` instâncias. Lê o serviço antes e recusa com disco ou autoescala nativa.
   * Lança `ScalerNotConfiguredError`, `ScalerServiceNotScalableError`, `ScalerRateLimitedError`
   * ou `ScalerUnavailableError`.
   */
  scaleTo(replicas: number): Promise<void>;
}
