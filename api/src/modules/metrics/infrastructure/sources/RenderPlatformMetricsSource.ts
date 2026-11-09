import type { IPlatformMetricsSource } from '../../domain/contracts/IPlatformMetricsSource';
import { OPS_METRIC, type OpsMetricReading } from '../../domain/OpsMetric';
import { logger } from '../../../../shared/logger/logger';

/**
 * Render Metrics API (MQ-22), conferida em 2026-11-09 em https://api-docs.render.com/reference/get-cpu
 * (e `get-memory`, `get-cpu-limit`, `get-memory-limit`):
 * `GET https://api.render.com/v1/metrics/{cpu|cpu-limit|memory|memory-limit}` com Bearer, query
 * `resource` (ids `srv-`/`dpg-`/`red-` separados por vírgula, OR), `startTime`/`endTime` (ISO),
 * `resolutionSeconds` (≥ 30, padrão 60). Resposta: array de séries
 * `{ labels: [{ field, value }], values: [{ timestamp, value }], unit }`.
 * A doc não fixa a unidade (exemplo `GB`) nem os nomes dos labels: a série é identificada por
 * `instance` → `resource` → `service`, e o % sai da razão uso/limite da mesma série (independe da unidade).
 * Série com pontos mas sem `resource`/`service` é descartada e contada (`discardedSeries`): warn na
 * 1ª vez por endpoint, debug depois; nunca com chave, labels ou valores.
 * Formato de vários recursos: a doc (OpenAPI, 2026-11-09) tem `type: string` com exemplo
 * `srv-xxxxx,dpg-xxxxx,red-xxxxx` (vírgula), mas a descrição fala em "multiple resource query params"
 * (repetido). Sem `style`/`explode` definidos: mantido o formato do exemplo (vírgula). Se a Render
 * não separar, as séries voltam vazias para mais de um id: trocar por `resource` repetido.
 */
export const RENDER_API_URL = 'https://api.render.com/v1';
/** Teto por chamada: o tick de 60 s nunca espera a Render mais que isto. */
export const RENDER_FETCH_TIMEOUT_MS = 5_000;
/** Janela pedida: o último ponto de cada série é o valor do tick. */
const WINDOW_MS = 5 * 60_000;
const RESOLUTION_SECONDS = 60;

type Path = 'cpu' | 'cpu-limit' | 'memory' | 'memory-limit';
const PATHS: readonly Path[] = ['cpu', 'cpu-limit', 'memory', 'memory-limit'];

interface RenderSeries {
  labels?: { field?: string; value?: string }[];
  values?: { timestamp?: string; value?: number }[];
  unit?: string;
}

interface SeriesPoint {
  resource: string;
  instance: string | null;
  value: number;
  unit: string | null;
}

export interface RenderPlatformMetricsSourceOptions {
  apiKey: string;
  resourceIds: readonly string[];
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  now?: () => Date;
}

const label = (s: RenderSeries, field: string) => s.labels?.find((l) => l.field === field)?.value ?? null;

/** Último ponto finito de cada série; `stats.discarded` conta séries com ponto mas sem recurso. */
export function lastPoints(series: unknown, stats?: { discarded: number }): SeriesPoint[] {
  if (!Array.isArray(series)) return [];
  const out: SeriesPoint[] = [];
  for (const s of series as RenderSeries[]) {
    const values = (s.values ?? []).filter((v) => typeof v.value === 'number' && Number.isFinite(v.value));
    const last = values[values.length - 1];
    if (!last) continue;
    const resource = label(s, 'resource') ?? label(s, 'service');
    if (!resource) {
      if (stats) stats.discarded += 1;
      continue;
    }
    out.push({ resource, instance: label(s, 'instance'), value: last.value!, unit: s.unit ?? null });
  }
  return out;
}

const seriesId = (p: SeriesPoint) => p.instance ?? p.resource;
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Junta uso e limite por série; o limite pode vir só por recurso (sem `instance`). */
function toReadings(usage: SeriesPoint[], limits: SeriesPoint[], raw: string, pct: string): OpsMetricReading[] {
  const byId = new Map(limits.map((l) => [seriesId(l), l.value]));
  const byResource = new Map(limits.map((l) => [l.resource, l.value]));
  const out: OpsMetricReading[] = [];
  for (const u of usage) {
    const id = seriesId(u);
    out.push({ source: 'render', resource: id, metric: raw, value: round(u.value), kind: 'gauge', meta: { unit: u.unit } });
    const limit = byId.get(id) ?? byResource.get(u.resource);
    if (limit && limit > 0) {
      out.push({ source: 'render', resource: id, metric: pct, value: round((u.value / limit) * 100), kind: 'gauge' });
    }
  }
  return out;
}

export class RenderPlatformMetricsSource implements IPlatformMetricsSource {
  private readonly log = logger.child({ module: 'RenderPlatformMetricsSource' });
  /** Endpoints que já deram warn de série descartada: depois só debug (sem spam a cada tick). */
  private readonly warnedDiscard = new Set<Path>();

  constructor(private readonly options: RenderPlatformMetricsSourceOptions) {}

  async read(signal?: AbortSignal): Promise<OpsMetricReading[]> {
    const results = await Promise.allSettled(PATHS.map((p) => this.fetchPath(p, signal)));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === PATHS.length) throw new Error('render metrics unavailable');
    const get = (p: Path) => {
      const r = results[PATHS.indexOf(p)]!;
      if (r.status === 'fulfilled') return r.value;
      // Só a mensagem montada aqui (status/timeout): nunca header nem chave
      this.log.warn({ path: p, err: (r.reason as Error)?.message }, 'render metrics endpoint failed');
      return [];
    };
    return [
      ...toReadings(get('cpu'), get('cpu-limit'), OPS_METRIC.cpu, OPS_METRIC.cpuPct),
      ...toReadings(get('memory'), get('memory-limit'), OPS_METRIC.memory, OPS_METRIC.memoryPct),
    ];
  }

  private async fetchPath(path: Path, signal?: AbortSignal): Promise<SeriesPoint[]> {
    const { apiKey, resourceIds } = this.options;
    const now = this.options.now?.() ?? new Date();
    const qs = new URLSearchParams({
      resource: resourceIds.join(','),
      startTime: new Date(now.getTime() - WINDOW_MS).toISOString(),
      endTime: now.toISOString(),
      resolutionSeconds: String(RESOLUTION_SECONDS),
    });
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? RENDER_FETCH_TIMEOUT_MS);
    const response = await (this.options.fetchFn ?? fetch)(`${this.options.baseUrl ?? RENDER_API_URL}/metrics/${path}?${qs}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const stats = { discarded: 0 };
    const points = lastPoints(await response.json(), stats);
    if (stats.discarded > 0) {
      const first = !this.warnedDiscard.has(path);
      this.warnedDiscard.add(path);
      this.log[first ? 'warn' : 'debug']({ path, discardedSeries: stats.discarded }, 'render metrics series without resource label discarded');
    }
    return points;
  }
}
