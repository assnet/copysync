import { AppError } from '../AppError';

// ── Configuração de escala dos workers (docs: .specs/features/worker-scaling) ─────

/** Configuração fora da faixa, de tipo errado ou com campo desconhecido (WSCALE-01). */
export class InvalidWorkerScalingSettingsError extends AppError {
  constructor(public readonly field: string, reason: string) {
    super('INVALID_WORKER_SCALING_SETTINGS', `Invalid worker scaling setting "${field}": ${reason}`, 400, { field });
  }
}

/** Outro admin salvou depois do `expectedUpdatedAt` informado (WSCALE-06). */
export class WorkerScalingSettingsConflictError extends AppError {
  constructor() {
    super('WORKER_SCALING_SETTINGS_CONFLICT', 'Worker scaling settings were changed by someone else', 409);
  }
}

// ── Escalador de workers (WSCALE-11) ─────────────────────────────────────────
// Nenhum erro carrega chave, id do serviço nem corpo da resposta do provedor.

/** Falta `WORKER_SCALER_ENABLED`, `RENDER_API_KEY` ou `WORKER_SCALER_SERVICE_ID`: nada foi chamado. */
export class ScalerNotConfiguredError extends AppError {
  constructor(missing: readonly string[]) {
    super('SCALER_NOT_CONFIGURED', 'Worker scaler is not configured', 409, { missing: [...missing] });
  }
}

/**
 * Provedor recusou a credencial, não achou o serviço, falhou (5xx) ou estourou o timeout.
 * `phase`: `read` (GET de leitura, nenhum pedido de escala saiu: nada foi alterado) ou `write`
 * (o `POST /scale`). `uncertain` (só no `scaleTo`, fase `write`, com `timeout`/`upstream`): o
 * provedor pode ter aplicado; vai em `meta.uncertain` para o painel não dizer "nada foi alterado".
 */
export class ScalerUnavailableError extends AppError {
  constructor(
    public readonly reason: 'auth' | 'not_found' | 'upstream' | 'timeout',
    public readonly phase: 'read' | 'write' = 'write',
    uncertain = false,
  ) {
    super('SCALER_UNAVAILABLE', `Worker scaler provider unavailable (${reason})`, 503, {
      reason,
      ...(phase === 'read' ? { phase } : {}),
      ...(uncertain ? { uncertain: true } : {}),
    });
  }
}

/**
 * Provedor respondeu 429. `retryAfterSeconds` vem do `Retry-After` (null se ausente ou inválido);
 * `meta.retryAt` (ISO, a partir de `now`) faz o `errorHandler` devolver o `Retry-After` ao cliente.
 */
export class ScalerRateLimitedError extends AppError {
  constructor(public readonly retryAfterSeconds: number | null, now: Date = new Date()) {
    super('SCALER_RATE_LIMITED', 'Worker scaler provider rate limited the request', 429, {
      retryAfterSeconds,
      retryAt: retryAfterSeconds == null ? null : new Date(now.getTime() + retryAfterSeconds * 1000).toISOString(),
    });
  }
}

/** Serviço com disco ou com autoescala nativa ligada: escalar por aqui é recusado. */
export class ScalerServiceNotScalableError extends AppError {
  constructor(public readonly reason: 'disk' | 'native_autoscaling') {
    super('SCALER_SERVICE_NOT_SCALABLE', `Worker service cannot be scaled (${reason})`, 409, { reason });
  }
}

// ── Regras do pedido de escala (WSCALE-12) ───────────────────────────────────

/** `scalerMode = off`: escalar pelo painel está desligado na configuração. */
export class ScalerModeOffError extends AppError {
  constructor() {
    super('SCALER_MODE_OFF', 'Worker scaling is turned off in the settings', 409);
  }
}

/** Adoção de sessões desligada (`WORKER_ADOPTION_ENABLED`): réplica nova não adotaria sessão. */
export class AdoptionDisabledError extends AppError {
  constructor() {
    super('ADOPTION_DISABLED', 'Session adoption by workers is disabled', 409);
  }
}

/** Alvo fora de `[minReplicas, maxReplicas]` ou, no automático, diferente de atual + 1. */
export class ScaleTargetOutOfRangeError extends AppError {
  constructor(min: number, max: number) {
    super('SCALE_TARGET_OUT_OF_RANGE', `Target replicas must be between ${min} and ${max}`, 400, {
      field: 'replicas',
      min,
      max,
    });
  }
}

/** Alvo igual às réplicas atuais: nada a pedir. */
export class ScaleTargetUnchangedError extends AppError {
  constructor(replicas: number) {
    super('SCALE_TARGET_UNCHANGED', 'Target replicas equal the current replicas', 409, { replicas });
  }
}

/** Dentro de `scaleCooldownSeconds` desde o último pedido aceito. */
export class ScaleCooldownActiveError extends AppError {
  constructor(public readonly retryAt: Date) {
    super('SCALE_COOLDOWN_ACTIVE', 'Wait for the minimum interval between scale requests', 409, {
      retryAt: retryAt.toISOString(),
    });
  }
}

/** Mesmo `requestId` com alvo, motivo ou ator diferentes do pedido gravado: o painel gera outro id. */
export class ScaleRequestIdReusedError extends AppError {
  constructor() {
    super('REQUEST_ID_REUSED', 'This request id was already used for a different scale request', 409, { field: 'requestId' });
  }
}

/**
 * Falha inesperada no pedido de escala; a mensagem original nunca sai (pode ter credencial).
 * Sempre incerta (`meta.uncertain`): o provedor pode ter aplicado.
 */
export class ScaleRequestFailedError extends AppError {
  constructor() {
    super('SCALE_REQUEST_FAILED', 'The scale request failed', 503, { uncertain: true });
  }
}

/** Motivo com menos de 3 ou mais de 200 caracteres depois de tirar os espaços das pontas. */
export class InvalidScaleReasonError extends AppError {
  constructor(min: number, max: number) {
    super('INVALID_SCALE_REASON', `Reason must have between ${min} and ${max} characters`, 400, { field: 'reason', min, max });
  }
}

/** Redução deixaria menos vagas (`replicas × teto × ratio`) que sessões conectadas. */
export class ScaleDownWouldExceedCapacityError extends AppError {
  constructor(numbers: { replicas: number; maxSessionsPerWorker: number; ratio: number; connected: number; capacity: number }) {
    super('SCALE_DOWN_WOULD_EXCEED_CAPACITY', 'Scaling down would leave less capacity than connected sessions', 409, {
      ...numbers,
    });
  }
}
