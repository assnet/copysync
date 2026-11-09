import type { OpsMetricReading, OpsMetricSample } from '../OpsMetric';

export interface OpsMetricTick {
  at: Date;
  readings: readonly OpsMetricReading[];
}

const key = (r: Pick<OpsMetricReading, 'source' | 'resource' | 'metric'>) => `${r.source}|${r.resource}|${r.metric}`;
const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Agrega os ticks de uma janela em 1 linha por (source, resource, metric), MQ-23. `gauge` = média
 * com `min`/`max`/`n` em `meta`; `counter` = último valor (média de acumulado não diz nada). Pura.
 */
export function aggregateOpsMetrics(ticks: readonly OpsMetricTick[], at: Date): OpsMetricSample[] {
  const groups = new Map<string, OpsMetricReading[]>();
  for (const tick of ticks) {
    for (const r of tick.readings) {
      if (!Number.isFinite(r.value)) continue;
      const k = key(r);
      const list = groups.get(k);
      if (list) list.push(r);
      else groups.set(k, [r]);
    }
  }
  const out: OpsMetricSample[] = [];
  for (const list of groups.values()) {
    const last = list[list.length - 1]!;
    const values = list.map((r) => r.value);
    const base = { at, source: last.source, resource: last.resource, metric: last.metric };
    if (last.kind === 'counter') {
      out.push({ ...base, value: last.value, meta: { ...(last.meta ?? {}), n: list.length } });
      continue;
    }
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    out.push({
      ...base,
      value: round(avg),
      meta: { ...(last.meta ?? {}), min: round(Math.min(...values)), max: round(Math.max(...values)), n: values.length },
    });
  }
  return out;
}
