import type { IWorkerScaler, WorkerScalerState } from '../../domain/contracts/IWorkerScaler';
import {
  ScalerRateLimitedError,
  ScalerServiceNotScalableError,
  ScalerUnavailableError,
} from '../../../../shared/errors/internal/WorkerScalingErrors';
import { logger } from '../../../../shared/logger/logger';
import { AppError } from '../../../../shared/errors/AppError';

/**
 * Render API (WSCALE-11), mesmo padrão de `RenderPlatformMetricsSource` (fetch injetável,
 * `AbortSignal.timeout`, chave só no header):
 * - `GET /v1/services/{id}` → `serviceDetails.numInstances`, `serviceDetails.autoscaling.enabled`,
 *   `serviceDetails.disk` (objeto ou null);
 * - `GET /v1/services/{id}/instances` → array de instâncias rodando;
 * - `POST /v1/services/{id}/scale` `{ numInstances }` → 202.
 * Log só com operação, status e motivo: nunca chave, id do serviço nem corpo.
 */
export const RENDER_SCALER_API_URL = 'https://api.render.com/v1';
export const RENDER_SCALER_TIMEOUT_MS = 5_000;

export interface RenderWorkerScalerOptions {
  apiKey: string;
  serviceId: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

type Operation = 'service' | 'instances' | 'scale';

interface ServiceSnapshot {
  desiredReplicas: number;
  hasDisk: boolean;
  autoscalingEnabled: boolean;
}

/** `Retry-After` em segundos ou data HTTP; null se ausente ou inválido. */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseService(body: unknown): ServiceSnapshot {
  const details = isRecord(body) && isRecord(body.serviceDetails) ? body.serviceDetails : null;
  const num = details?.numInstances;
  if (!details || typeof num !== 'number' || !Number.isInteger(num) || num < 0) {
    throw new ScalerUnavailableError('upstream');
  }
  const autoscaling = details.autoscaling;
  return {
    desiredReplicas: num,
    hasDisk: isRecord(details.disk),
    autoscalingEnabled: isRecord(autoscaling) && autoscaling.enabled === true,
  };
}

/** A doc devolve um array de instâncias; cada item é uma réplica rodando. */
function parseInstances(body: unknown): number {
  if (!Array.isArray(body)) throw new ScalerUnavailableError('upstream');
  return body.length;
}

export class RenderWorkerScaler implements IWorkerScaler {
  private readonly log = logger.child({ module: 'RenderWorkerScaler' });

  constructor(private readonly options: RenderWorkerScalerOptions) {}

  async getState(): Promise<WorkerScalerState> {
    try {
      const [service, running] = await Promise.all([
        this.readService(),
        this.request('instances', 'GET', '/instances').then(parseInstances),
      ]);
      return { status: 'ready', ...service, runningReplicas: running };
    } catch (err) {
      if (err instanceof ScalerRateLimitedError) {
        return { status: 'unavailable', reason: 'rate_limited', retryAfterSeconds: err.retryAfterSeconds };
      }
      if (err instanceof ScalerUnavailableError) return { status: 'unavailable', reason: err.reason };
      // Erro fora do contrato (resposta inesperada, bug de parse): nunca sobe cru. Log sem o erro:
      // a mensagem pode carregar URL (id do serviço) ou trecho do corpo.
      if (!(err instanceof AppError)) {
        this.log.warn({ op: 'state', reason: 'unexpected' }, 'worker scaler state failed unexpectedly');
        return { status: 'unavailable', reason: 'upstream' };
      }
      throw err;
    }
  }

  async scaleTo(replicas: number): Promise<void> {
    if (!Number.isInteger(replicas) || replicas < 1) throw new RangeError('replicas must be a positive integer');
    const service = await this.readService();
    if (service.hasDisk) throw new ScalerServiceNotScalableError('disk');
    if (service.autoscalingEnabled) throw new ScalerServiceNotScalableError('native_autoscaling');
    await this.request('scale', 'POST', '/scale', { numInstances: replicas });
  }

  private async readService(): Promise<ServiceSnapshot> {
    return parseService(await this.request('service', 'GET', ''));
  }

  /** Faz a chamada e traduz falha para erro interno. Devolve o JSON (ou null sem corpo). */
  private async request(op: Operation, method: 'GET' | 'POST', suffix: string, body?: unknown): Promise<unknown> {
    const { apiKey, serviceId } = this.options;
    const url = `${this.options.baseUrl ?? RENDER_SCALER_API_URL}/services/${encodeURIComponent(serviceId)}${suffix}`;
    let response: Response;
    try {
      response = await (this.options.fetchFn ?? fetch)(url, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? RENDER_SCALER_TIMEOUT_MS),
      });
    } catch (err) {
      const name = (err as Error)?.name;
      const reason = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'upstream';
      this.log.warn({ op, reason }, 'worker scaler request failed');
      throw new ScalerUnavailableError(reason);
    }
    if (!response.ok) throw this.translateStatus(op, response);
    if (method === 'POST') return null;
    try {
      return await response.json();
    } catch {
      this.log.warn({ op, reason: 'invalid_body' }, 'worker scaler request failed');
      throw new ScalerUnavailableError('upstream');
    }
  }

  private translateStatus(op: Operation, response: Response): Error {
    const status = response.status;
    if (status === 429) {
      const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'));
      this.log.warn({ op, status, retryAfterSeconds }, 'worker scaler rate limited');
      return new ScalerRateLimitedError(retryAfterSeconds);
    }
    const reason = status === 401 || status === 403 ? 'auth' : status === 404 ? 'not_found' : 'upstream';
    this.log.warn({ op, status, reason }, 'worker scaler request failed');
    return new ScalerUnavailableError(reason);
  }
}
