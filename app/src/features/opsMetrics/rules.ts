/** Regras puras da aba Consumo: janela, status vs limiar, delta de counter, alinhamento e formatação. */
import type {
  OpsKind, OpsLatestValue, OpsRange, OpsResourceFilter, OpsSeries, OpsServerKind, OpsSeriesPoint, OpsStatus, OpsTopQuery, OpsWorker,
  UsageFilters,
} from './types';

const MIN = 60_000;

export const OPS_RANGES: OpsRange[] = ['1h', '6h', '24h', '7d'];
export const OPS_RANGE_MS: Record<OpsRange, number> = { '1h': 60 * MIN, '6h': 360 * MIN, '24h': 1440 * MIN, '7d': 10_080 * MIN };

/** Fração do limiar a partir da qual o status vira "Atenção" (ex.: RAM 70% com limite 80%). */
export const WARNING_RATIO = 0.875;
/**
 * Cache hit não tem limiar na API: decisão da tela. Ok ≥ 99, Atenção 95–99, Crítico < 95
 * (abaixo de 99% o Postgres já lê do disco com frequência).
 */
export const CACHE_HIT_OK = 99;
export const CACHE_HIT_WARNING = 95;
/** Limite de RAM do serviço da API (plano atual), usado só para traduzir % em MB no KPI. */
export const API_MEMORY_LIMIT_MB = 2048;
/** Amostra mais velha que isso com a coleta ativa = coletor provavelmente travado. */
export const STALE_AFTER_MIN = 15;
/** Acima disso o gráfico por worker some e fica só a tabela (sem gerar cor nova). */
export const MAX_WORKERS_IN_CHART = 3;

export const OPS_RESOURCE_FILTERS: OpsResourceFilter[] = ['all', 'api', 'worker_service', 'postgres'];
export const DEFAULT_USAGE_FILTERS: UsageFilters = { range: '24h', resource: 'all', autoRefresh: true };

/**
 * Filtros lidos do sessionStorage: valor fora dos permitidos (versão antiga, edição manual) cai
 * no padrão campo a campo. Sem isso, `range` inválido vira `NaN` e `toISOString` lança.
 */
export function parseUsageFilters(raw: unknown): UsageFilters {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_USAGE_FILTERS;
  return {
    range: OPS_RANGES.includes(o.range as OpsRange) ? (o.range as OpsRange) : d.range,
    resource: OPS_RESOURCE_FILTERS.includes(o.resource as OpsResourceFilter) ? (o.resource as OpsResourceFilter) : d.resource,
    autoRefresh: typeof o.autoRefresh === 'boolean' ? o.autoRefresh : d.autoRefresh,
  };
}

export function rangeWindow(range: OpsRange, nowMs: number): { from: string; to: string } {
  return { from: new Date(nowMs - OPS_RANGE_MS[range]).toISOString(), to: new Date(nowMs).toISOString() };
}

/** Status de um valor contra o limiar (maior = pior). */
export function statusFor(value: number | null | undefined, threshold: number): OpsStatus {
  if (value == null || !Number.isFinite(value)) return 'noData';
  if (value >= threshold) return 'critical';
  if (value >= threshold * WARNING_RATIO) return 'warning';
  return 'ok';
}

/** Cache hit: menor = pior. */
export function cacheHitStatus(value: number | null | undefined): OpsStatus {
  if (value == null || !Number.isFinite(value)) return 'noData';
  if (value >= CACHE_HIT_OK) return 'ok';
  if (value >= CACHE_HIT_WARNING) return 'warning';
  return 'critical';
}

export function isStale(atIso: string | null | undefined, nowMs: number, maxMinutes = STALE_AFTER_MIN): boolean {
  if (!atIso) return false;
  const t = new Date(atIso).getTime();
  return Number.isFinite(t) && nowMs - t > maxMinutes * MIN;
}

/** Filtro de recurso esconde só séries/KPIs de CPU e RAM do outro recurso. */
export function resourceVisible(filter: OpsResourceFilter, kind: OpsServerKind): boolean {
  return filter === 'all' || filter === kind;
}

/**
 * Pontos de uma métrica para um tipo de recurso. Vários recursos do mesmo tipo (ex.: dois `srv-`)
 * viram uma série só com o pior valor por balde: a tela mostra API × Postgres, nunca o id.
 */
export function seriesPoints(series: OpsSeries[], metric: string, kind?: OpsKind): OpsSeriesPoint[] {
  const matching = series.filter((s) => s.metric === metric && (!kind || s.kind === kind));
  if (matching.length === 1) return matching[0].points;
  const byAt = new Map<string, OpsSeriesPoint>();
  for (const s of matching) {
    for (const p of s.points) {
      const prev = byAt.get(p.at);
      byAt.set(p.at, prev
        ? { at: p.at, avg: Math.max(prev.avg, p.avg), min: Math.max(prev.min, p.min), max: Math.max(prev.max, p.max) }
        : p);
    }
  }
  return [...byAt.values()].sort((a, b) => a.at.localeCompare(b.at));
}

/** Séries por recurso (ex.: um worker por série), ordenadas pelo id. */
export function seriesByResource(series: OpsSeries[], metric: string): { resource: string; points: OpsSeriesPoint[] }[] {
  return series
    .filter((s) => s.metric === metric)
    .map((s) => ({ resource: s.resource, points: s.points }))
    .sort((a, b) => a.resource.localeCompare(b.resource));
}

export interface AlignedSeries {
  /** Instantes (ms) do eixo X, união das séries. */
  times: number[];
  /** Por série, o ponto em cada instante ou `null` (buraco = linha interrompida). */
  rows: (OpsSeriesPoint | null)[][];
}

/**
 * Junta várias séries num eixo X comum. Falta de mais de 2 baldes entre amostras vira um ponto
 * vazio, para a linha interromper (`connectNulls: false`) em vez de ligar o buraco.
 */
export function alignSeries(list: OpsSeriesPoint[][], bucketMinutes: number): AlignedSeries {
  const step = Math.max(1, bucketMinutes) * MIN;
  const set = new Set<number>();
  for (const pts of list) for (const p of pts) set.add(new Date(p.at).getTime());
  const sorted = [...set].filter(Number.isFinite).sort((a, b) => a - b);
  const times: number[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i] - sorted[i - 1] > step * 3) times.push(sorted[i - 1] + step);
    times.push(sorted[i]);
  }
  const rows = list.map((pts) => {
    const byT = new Map(pts.map((p) => [new Date(p.at).getTime(), p]));
    return times.map((t) => byT.get(t) ?? null);
  });
  return { times, rows };
}

/**
 * Delta de um counter acumulado entre baldes consecutivos (usa o máximo do balde = leitura mais
 * recente). 1º balde e delta negativo (reinício do Postgres zerou o acumulado) = `null`.
 */
export function counterDeltas(points: (OpsSeriesPoint | null)[]): (number | null)[] {
  let prev: number | null = null;
  return points.map((p) => {
    if (!p) return null;
    const cur = p.max;
    const d = prev == null ? null : cur - prev;
    prev = cur;
    return d == null || d < 0 ? null : d;
  });
}

/**
 * Taxa por minuto de um counter acumulado, alinhado em `times` (ms). Divide o delta pelo intervalo
 * real até o ponto não nulo anterior: depois de um buraco o acumulado de vários baldes não vira
 * pico falso. Delta negativo (reinício do Postgres zerou o acumulado) = 0. Reinício dentro de um
 * balde não é detectável: o máximo do balde já mistura antes e depois, e o delta sai subestimado.
 * 1º ponto e buracos = `null`.
 */
export function counterRatePerMinute(points: (OpsSeriesPoint | null)[], times: number[]): (number | null)[] {
  let prev: { v: number; t: number } | null = null;
  return points.map((p, i) => {
    const t = times[i];
    if (!p || !Number.isFinite(t)) return null;
    const cur = { v: p.max, t };
    const last = prev;
    prev = cur;
    if (!last || cur.t <= last.t) return null;
    const delta = cur.v - last.v;
    return delta < 0 ? 0 : delta / ((cur.t - last.t) / MIN);
  });
}

/** Soma dos deltas do período (reinícios descartados); `null` sem pontos. */
export function counterPeriodTotal(points: OpsSeriesPoint[]): number | null {
  if (points.length === 0) return null;
  const first = points[0].max - points[0].min;
  const rest = counterDeltas(points).reduce<number>((acc, d) => acc + (d ?? 0), 0);
  return Math.max(0, first) + rest;
}

/** Último valor de uma métrica (pior entre recursos do mesmo tipo). */
export function latestValue(latest: OpsLatestValue[], metric: string, kind?: OpsKind): OpsLatestValue | null {
  let best: OpsLatestValue | null = null;
  for (const v of latest) {
    if (v.metric !== metric || (kind && v.kind !== kind)) continue;
    if (!best || v.value > best.value) best = v;
  }
  return best;
}

/** Tolerância da "instância atual": amostras até 2 min antes da mais nova do mesmo tipo e métrica. */
export const CURRENT_INSTANCE_SLACK_MS = 2 * MIN;

/**
 * Valores atuais de um tipo e métrica: só os com `at` ≥ (mais nova − 2 min). O `/latest` cobre
 * 15 min, então instância trocada por deploy ainda vem nele; sem esse corte ela entraria na
 * contagem e poderia ser o "pior" valor.
 */
export function currentValues(latest: OpsLatestValue[], metric: string, kind: OpsKind): OpsLatestValue[] {
  const own = latest.filter((v) => v.metric === metric && v.kind === kind);
  const newest = Math.max(...own.map((v) => new Date(v.at).getTime()).filter(Number.isFinite));
  if (!Number.isFinite(newest)) return [];
  return own.filter((v) => new Date(v.at).getTime() >= newest - CURRENT_INSTANCE_SLACK_MS);
}

/** Quantos recursos distintos do tipo têm valor atual da métrica (ex.: instâncias do worker). */
export function resourceCount(latest: OpsLatestValue[], metric: string, kind: OpsKind): number {
  return new Set(currentValues(latest, metric, kind).map((v) => v.resource)).size;
}

/** Horário da amostra mais recente entre os valores atuais e as séries (base do "atualizado há"). */
export function newestSampleAt(latest: OpsLatestValue[], series: OpsSeries[]): string | null {
  let best: string | null = null;
  for (const v of latest) if (!best || v.at > best) best = v.at;
  if (best) return best;
  for (const s of series) {
    const last = s.points[s.points.length - 1];
    if (last && (!best || last.at > best)) best = last.at;
  }
  return best;
}

export function hasHeartbeat(workers: OpsWorker[]): boolean {
  return workers.length > 0;
}

/** Participação (%, inteiro) de cada consulta no total das listadas. */
export function querySharePct(queries: OpsTopQuery[]): number[] {
  const total = queries.reduce((a, q) => a + Math.max(0, q.totalMs), 0);
  return queries.map((q) => (total > 0 ? Math.round((Math.max(0, q.totalMs) / total) * 100) : 0));
}

export function shortQueryId(id: string): string {
  return id.length > 8 ? `…${id.slice(-8)}` : id;
}

export function valueStats(values: (number | null)[]): { min: number; max: number; avg: number } | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length === 0) return null;
  return { min: Math.min(...v), max: Math.max(...v), avg: v.reduce((a, b) => a + b, 0) / v.length };
}

/** Domínio Y de contagens: `[0, max × 1,1]`, incluindo o limiar para a linha sempre aparecer. */
export function countDomainMax(values: (number | null)[], threshold?: number): number {
  const max = Math.max(0, ...values.filter((x): x is number => x != null), threshold ?? 0);
  return max > 0 ? Math.ceil(max * 1.1) : 1;
}

/** Domínio Y do cache hit: `[min(90, menor valor), 100]`. */
export function cacheHitDomainMin(values: (number | null)[]): number {
  const v = values.filter((x): x is number => x != null);
  return Math.floor(Math.min(90, ...v));
}

// ---- Formatação (pt-BR) ----

export function formatNumber(v: number, maxFractionDigits = 0): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: maxFractionDigits });
}

/** "62%", "99,6%". Abaixo de 10 ou fracionário relevante mostra 1 casa. */
export function formatPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${formatNumber(v, Math.abs(v - Math.round(v)) >= 0.05 ? 1 : 0)}%`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.max(0, bytes);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${formatNumber(v, i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Milissegundos em texto curto: "850 ms", "12 s", "4 min 12 s", "2 h 5 min". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const v = Math.max(0, ms);
  if (v < 1000) return `${formatNumber(v)} ms`;
  const totalS = Math.round(v / 1000);
  if (totalS < 60) return `${totalS} s`;
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return s > 0 ? `${m} min ${s} s` : `${m} min`;
}

/** Tick do eixo de tempo: `HH:mm` até 24 h, `dd/MM` em 7 dias (fuso do navegador). */
export function formatTick(ms: number, range: OpsRange): string {
  const d = new Date(ms);
  return range === '7d'
    ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(ms: number | string): string {
  return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
