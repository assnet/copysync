import type {
  IInfraResourcePlanReader,
  InfraRenderResourceType,
  InfraRenderResult,
  InfraRenderUnavailable,
  InfraRenderUnavailableReason,
  InfraResourcePlanReading,
} from '../../domain/contracts/IInfraResourcePlanReader';
import type { InfraRenderKey } from '../../domain/services/infraCostSettings';
import { parseRetryAfter } from '../../../sessions/infrastructure/scaler/RenderWorkerScaler';
import { logger } from '../../../../shared/logger/logger';

/**
 * Render API para os custos por hora (COST-09), mesmo padrão de `RenderWorkerScaler` e
 * `RenderPlatformMetricsSource` (fetch injetável, `AbortSignal.timeout` 5 s, chave só no header):
 * - `GET /v1/services/{id}` → `suspended`, `serviceDetails.plan`, `numInstances`, `disk.sizeGB`;
 * - `GET /v1/postgres/{id}` → `plan`, `diskSizeGB`, `status`;
 * - `GET /v1/key-value/{id}` → `plan`, `status` (formato não confirmado: campo ausente = `null`);
 * - `GET /v1/metrics/bandwidth` com `resource` repetido, `startTime`/`endTime`, sem `resolution`
 *   (1 ponto por hora; série `{ labels: [{ field: 'service', value }], values, unit }`);
 * - `GET /v1/services/{id}/deploys` com `limit` ≤ 100, `finishedAfter`/`finishedBefore` e `cursor`
 *   (itens `{ deploy: { id, status, startedAt, finishedAt }, cursor }`).
 * 429: `Retry-After`, senão `Ratelimit-Reset`. Log só com operação, chave lógica, status e motivo:
 * nunca chave da API, id do recurso, URL nem corpo.
 */
export const RENDER_INFRA_API_URL = 'https://api.render.com/v1';
export const RENDER_INFRA_TIMEOUT_MS = 5_000;
const DEPLOYS_PAGE_LIMIT = 100;
/** Teto de páginas por serviço e dia: 2.000 deploys num dia já é erro, não uso. */
const DEPLOYS_MAX_PAGES = 20;

export interface RenderInfraResourcePlanReaderOptions {
  apiKey: string;
  /** Chave lógica → id da Render (`INFRA_COST_RENDER_RESOURCES`). */
  resources: ReadonlyMap<InfraRenderKey, string>;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

type Operation = 'resource' | 'bandwidth' | 'deploys';

/** Tipo pelo prefixo do id; fora dos três = `null`. */
export function infraResourceTypeOf(id: string): InfraRenderResourceType | null {
  if (id.startsWith('srv-')) return 'service';
  if (id.startsWith('dpg-')) return 'postgres';
  if (id.startsWith('red-')) return 'key_value';
  return null;
}

/** Bytes por unidade da Render. A unidade vem sempre do campo `unit`; desconhecida = série descartada. */
const BYTES_PER_UNIT: Record<string, number> = {
  b: 1, byte: 1, bytes: 1,
  kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12,
  kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
};

/** Fator para GB (10⁹ bytes) ou `null` se a unidade for ausente/desconhecida. */
export function bandwidthUnitToGb(unit: unknown): number | null {
  if (typeof unit !== 'string') return null;
  const bytes = BYTES_PER_UNIT[unit.trim().toLowerCase()];
  return bytes === undefined ? null : bytes / 1e9;
}

/** Campos lidos que diferem do cadastro (`config_drift`). `null`/`undefined` em qualquer lado não compara. */
export function infraResourceDriftFields(
  reading: Pick<InfraResourcePlanReading, 'plan' | 'instances' | 'diskGb'>,
  expected: { plan?: string | null; instances?: number | null; diskGb?: number | null },
): ('plan' | 'instances' | 'diskGb')[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const out: ('plan' | 'instances' | 'diskGb')[] = [];
  if (reading.plan != null && expected.plan != null && norm(reading.plan) !== norm(expected.plan)) out.push('plan');
  if (reading.instances != null && expected.instances != null && reading.instances !== expected.instances) out.push('instances');
  if (reading.diskGb != null && expected.diskGb != null && reading.diskGb !== expected.diskGb) out.push('diskGb');
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
const nonNegInt = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
const nonNegNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const statusSuspended = (v: unknown) => (typeof v === 'string' ? v === 'suspended' : null);

class RenderRequestError extends Error {
  constructor(readonly failure: InfraRenderUnavailable) {
    super(failure.reason);
  }
}

function parseReading(key: InfraRenderKey, type: InfraRenderResourceType, body: unknown): InfraResourcePlanReading {
  if (!isRecord(body)) throw new RenderRequestError({ status: 'unavailable', reason: 'upstream' });
  if (type === 'service') {
    const d = isRecord(body.serviceDetails) ? body.serviceDetails : {};
    const disk = isRecord(d.disk) ? d.disk : null;
    const suspended = body.suspended === 'suspended' ? true : body.suspended === 'not_suspended' ? false : null;
    return {
      resourceKey: key,
      resourceType: type,
      plan: str(d.plan),
      instances: nonNegInt(d.numInstances),
      diskGb: disk ? nonNegNum(disk.sizeGB) : null,
      suspended,
    };
  }
  return {
    resourceKey: key,
    resourceType: type,
    plan: str(body.plan),
    instances: 1,
    diskGb: type === 'postgres' ? nonNegNum(body.diskSizeGB) : null,
    suspended: statusSuspended(body.status),
  };
}

const RESOURCE_PATH: Record<InfraRenderResourceType, string> = {
  service: 'services',
  postgres: 'postgres',
  key_value: 'key-value',
};

export class RenderInfraResourcePlanReader implements IInfraResourcePlanReader {
  private readonly log = logger.child({ module: 'RenderInfraResourcePlanReader' });

  constructor(private readonly options: RenderInfraResourcePlanReaderOptions) {}

  configuredKeys(): InfraRenderKey[] {
    return [...this.options.resources.keys()];
  }

  async readResource(key: InfraRenderKey): Promise<InfraRenderResult<{ reading: InfraResourcePlanReading }>> {
    const id = this.options.resources.get(key);
    const type = id ? infraResourceTypeOf(id) : null;
    if (!id || !type) return { status: 'unavailable', reason: 'not_configured' };
    return this.guard(async () => {
      const body = await this.request('resource', key, `/${RESOURCE_PATH[type]}/${encodeURIComponent(id)}`);
      return { reading: parseReading(key, type, body) };
    });
  }

  async readBandwidthGb(start: Date, end: Date) {
    const services = this.services();
    if (services.length === 0) return { status: 'unavailable', reason: 'not_configured' } as const;
    return this.guard(async () => {
      const qs = new URLSearchParams();
      for (const [, id] of services) qs.append('resource', id);
      qs.set('startTime', start.toISOString());
      qs.set('endTime', end.toISOString());
      const body = await this.request('bandwidth', null, `/metrics/bandwidth?${qs}`);
      const keyById = new Map(services.map(([k, id]) => [id, k]));
      const byKey: Partial<Record<InfraRenderKey, number | null>> = Object.fromEntries(services.map(([k]) => [k, null]));
      let discardedSeries = 0;
      for (const s of Array.isArray(body) ? body : []) {
        if (!isRecord(s)) continue;
        const labels = Array.isArray(s.labels) ? s.labels.filter(isRecord) : [];
        const svc = labels.find((l) => l.field === 'service')?.value ?? labels.find((l) => l.field === 'resource')?.value;
        const key = typeof svc === 'string' ? keyById.get(svc) : undefined;
        if (!key) continue;
        const factor = bandwidthUnitToGb(s.unit);
        if (factor === null) {
          discardedSeries += 1;
          continue;
        }
        let sum = 0;
        for (const p of Array.isArray(s.values) ? s.values.filter(isRecord) : []) {
          const at = typeof p.timestamp === 'string' ? Date.parse(p.timestamp) : NaN;
          const v = nonNegNum(p.value);
          if (v === null || Number.isNaN(at) || at < start.getTime() || at >= end.getTime()) continue;
          sum += v * factor;
        }
        byKey[key] = (byKey[key] ?? 0) + sum;
      }
      if (discardedSeries > 0) {
        this.log.warn({ op: 'bandwidth', discardedSeries }, 'render bandwidth series without known unit discarded');
      }
      return { byKey, discardedSeries };
    });
  }

  async readBuildMinutes(start: Date, end: Date) {
    const services = this.services();
    if (services.length === 0) return { status: 'unavailable', reason: 'not_configured' } as const;
    return this.guard(async () => {
      const byKey: Partial<Record<InfraRenderKey, number>> = {};
      // Em sequência: poucas chamadas por dia, longe do limite de 400 GET/min
      for (const [key, id] of services) byKey[key] = await this.buildMinutesOf(key, id, start, end);
      return { byKey };
    });
  }

  private async buildMinutesOf(key: InfraRenderKey, id: string, start: Date, end: Date): Promise<number> {
    const seen = new Set<string>();
    let ms = 0;
    let cursor: string | null = null;
    for (let page = 0; page < DEPLOYS_MAX_PAGES; page += 1) {
      const qs = new URLSearchParams({
        limit: String(DEPLOYS_PAGE_LIMIT),
        finishedAfter: start.toISOString(),
        finishedBefore: end.toISOString(),
      });
      if (cursor) qs.set('cursor', cursor);
      const body = await this.request('deploys', key, `/services/${encodeURIComponent(id)}/deploys?${qs}`);
      if (!Array.isArray(body)) throw new RenderRequestError({ status: 'unavailable', reason: 'upstream' });
      for (const item of body) {
        const d = isRecord(item) && isRecord(item.deploy) ? item.deploy : null;
        if (!d) continue;
        const depId = str(d.id);
        if (depId) {
          if (seen.has(depId)) continue;
          seen.add(depId);
        }
        const s = typeof d.startedAt === 'string' ? Date.parse(d.startedAt) : NaN;
        const f = typeof d.finishedAt === 'string' ? Date.parse(d.finishedAt) : NaN;
        if (Number.isNaN(s) || Number.isNaN(f) || f < s) continue;
        ms += f - s;
      }
      const last = body[body.length - 1];
      const next = isRecord(last) ? str(last.cursor) : null;
      if (body.length < DEPLOYS_PAGE_LIMIT || !next || next === cursor) break;
      cursor = next;
    }
    return Math.round((ms / 60_000) * 100) / 100;
  }

  private services(): [InfraRenderKey, string][] {
    return [...this.options.resources].filter(([, id]) => infraResourceTypeOf(id) === 'service');
  }

  /** Converte falha em `unavailable`; erro fora do contrato vira `upstream` sem logar a mensagem (pode ter URL). */
  private async guard<T>(fn: () => Promise<T>): Promise<InfraRenderResult<T>> {
    try {
      return { status: 'ok', ...(await fn()) };
    } catch (err) {
      if (err instanceof RenderRequestError) return err.failure;
      this.log.warn({ reason: 'unexpected' }, 'render infra read failed unexpectedly');
      return { status: 'unavailable', reason: 'upstream' };
    }
  }

  private async request(op: Operation, key: InfraRenderKey | null, path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await (this.options.fetchFn ?? fetch)(`${this.options.baseUrl ?? RENDER_INFRA_API_URL}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${this.options.apiKey}` },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? RENDER_INFRA_TIMEOUT_MS),
      });
    } catch (err) {
      const name = (err as Error)?.name;
      const reason = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'upstream';
      this.log.warn({ op, key, reason }, 'render infra request failed');
      throw new RenderRequestError({ status: 'unavailable', reason });
    }
    if (!response.ok) throw new RenderRequestError(this.translateStatus(op, key, response));
    try {
      return await response.json();
    } catch {
      this.log.warn({ op, key, reason: 'invalid_body' }, 'render infra request failed');
      throw new RenderRequestError({ status: 'unavailable', reason: 'upstream' });
    }
  }

  private translateStatus(op: Operation, key: InfraRenderKey | null, response: Response): InfraRenderUnavailable {
    const status = response.status;
    if (status === 429) {
      const retryAfterSeconds =
        parseRetryAfter(response.headers.get('retry-after')) ?? parseRetryAfter(response.headers.get('ratelimit-reset'));
      this.log.warn({ op, key, status, retryAfterSeconds }, 'render infra rate limited');
      return { status: 'unavailable', reason: 'rate_limited', retryAfterSeconds };
    }
    const reason: InfraRenderUnavailableReason =
      status === 401 || status === 403 ? 'auth'
        : status === 404 ? 'not_found'
          : status >= 400 && status < 500 ? 'rejected_by_provider'
            : 'upstream';
    this.log.warn({ op, key, status, reason }, 'render infra request failed');
    return { status: 'unavailable', reason };
  }
}
