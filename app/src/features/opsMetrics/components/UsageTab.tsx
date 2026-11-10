import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Alert, Box, Button, Chip, FormControlLabel, Grid, IconButton, Skeleton, Stack, Switch, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography, useTheme,
} from '@mui/material';
import { Activity, CirclePause, Cpu, Database, Gauge, Info, MemoryStick, RefreshCw, Server, TriangleAlert } from 'lucide-react';
import { AppIcon } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { serverNow } from '@/services/serverClock';
import { formatRelativeTime } from '@/features/linkDomainsAdmin/rules';
import { chartColors } from '../chartColors';
import {
  API_MEMORY_LIMIT_MB, DEFAULT_USAGE_FILTERS, MAX_WORKERS_IN_CHART, OPS_RANGES, OPS_RESOURCE_FILTERS, alignSeries,
  cacheHitDomainMin, cacheHitStatus, counterPeriodTotal, counterRatePerMinute, countDomainMax, formatBytes, formatDateTime,
  formatNumber, formatPct, hasHeartbeat, isStale, latestValue, newestSampleAt, parseUsageFilters, resourceVisible,
  seriesByResource, seriesPoints, statusFor, valueStats,
} from '../rules';
import { opsMetricsStrings as t } from '../strings';
import type { OpsLatest, OpsResourceFilter, OpsSeries, OpsSeriesPoint, OpsRange, UsageFilters } from '../types';
import { useOpsMetrics, type OpsMetricsState } from '../useOpsMetrics';
import { CollectionOffState } from './CollectionOffState';
import { CommitsBarChart } from './CommitsBarChart';
import { MetricChartCard, type ChartTable } from './MetricChartCard';
import { TimeLineChart, type LineSpec, type TooltipExtra } from './TimeLineChart';
import { TopQueriesTable } from './TopQueriesTable';
import { UsageKpiTile, type UsageKpiTileProps } from './UsageKpiTile';

export const USAGE_FILTERS_KEY = 'workers.usage.filters';
const FILTER_PERSIST = { version: 1, deserialize: parseUsageFilters } as const;

const fmtCount = (v: number) => formatNumber(v);
const fmtMs = (v: number) => `${formatNumber(v)} ms`;
const fmtMb = (v: number) => `${formatNumber(v)} MB`;

const avgOf = (rows: (OpsSeriesPoint | null)[]) => rows.map((p) => (p ? p.avg : null));
const maxOf = (rows: (OpsSeriesPoint | null)[]) => rows.map((p) => (p ? p.max : null));
const minOf = (rows: (OpsSeriesPoint | null)[]) => rows.map((p) => (p ? p.min : null));
const lastAvg = (pts: OpsSeriesPoint[]) => (pts.length ? pts[pts.length - 1].avg : null);

interface TableSpec {
  label: string;
  rows: (OpsSeriesPoint | null)[];
  format: (v: number) => string;
  extra?: (i: number) => string;
}

/** Linhas da tabela equivalente: mais recente primeiro; série só aparece com ≥ 2 séries. */
function buildTable(times: number[], specs: TableSpec[], extraHeader?: string): ChartTable {
  const multi = specs.length > 1;
  const headers = [t.charts.tableCols.time, ...(multi ? [t.charts.tableCols.series] : []),
    t.charts.tableCols.avg, t.charts.tableCols.min, t.charts.tableCols.max, ...(extraHeader ? [extraHeader] : [])];
  const rows: string[][] = [];
  for (let i = times.length - 1; i >= 0; i -= 1) {
    for (const s of specs) {
      const p = s.rows[i];
      if (!p) continue;
      rows.push([formatDateTime(times[i]), ...(multi ? [s.label] : []), s.format(p.avg), s.format(p.min), s.format(p.max),
        ...(s.extra ? [s.extra(i)] : [])]);
    }
  }
  return { headers, rows };
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Typography variant="overline" component="h2" color="text.secondary" sx={{ display: 'block', mt: 4, mb: 1.5, fontWeight: 700 }}>
      {children}
    </Typography>
  );
}

function figureAria(title: string, values: (number | null)[], format: (v: number) => string, limit?: string) {
  const st = valueStats(values);
  return st ? t.charts.figureAria(title, format(st.avg), format(st.max), limit) : title;
}

interface HeaderProps {
  samplerActive: boolean | null;
  newestAt: string | null;
  fetching: boolean;
  onRefresh: () => void;
}

function UsageHeader({ samplerActive, newestAt, fetching, onRefresh }: HeaderProps) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
      {samplerActive != null && (
        <Tooltip title={samplerActive ? t.header.collectingHint : t.header.notCollectingHint} enterTouchDelay={0}>
          <Chip
            size="small"
            variant="outlined"
            color={samplerActive ? 'success' : 'default'}
            icon={<AppIcon icon={samplerActive ? Activity : CirclePause} size="sm" aria-hidden />}
            label={samplerActive ? t.header.collecting : t.header.notCollecting}
            tabIndex={0}
          />
        </Tooltip>
      )}
      {newestAt && (
        <Typography variant="caption" color="text.secondary">
          <Tooltip title={new Date(newestAt).toLocaleString('pt-BR')}>
            <time dateTime={newestAt}>{t.header.updatedAt(formatRelativeTime(newestAt, serverNow(), t.header.justNow))}</time>
          </Tooltip>
        </Typography>
      )}
      <Tooltip title={t.header.refresh}>
        <span>
          {/* Sem `disabled`: o botão desabilitado perde o foco do teclado no meio da atualização. */}
          <IconButton
            size="small"
            aria-label={t.header.refresh}
            onClick={fetching ? undefined : onRefresh}
            aria-busy={fetching}
            aria-disabled={fetching}
            sx={{
              '@keyframes opsSpin': { to: { transform: 'rotate(360deg)' } },
              '& svg': fetching ? { animation: 'opsSpin 1s linear infinite' } : {},
              ...(fetching ? { cursor: 'progress' } : {}),
              '@media (prefers-reduced-motion: reduce)': { '& svg': { animation: 'none' } },
            }}
          >
            <AppIcon icon={RefreshCw} size="sm" />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );
}

function Filters({ filters, onChange }: { filters: UsageFilters; onChange: (f: Partial<UsageFilters>) => void }) {
  const toggleSx = { minHeight: { xs: 44, sm: 32 }, px: 1.5, flex: { xs: 1, sm: 'none' } } as const;
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      spacing={{ xs: 1.5, md: 3 }}
      sx={{ alignItems: { xs: 'stretch', md: 'center' }, mt: 2 }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
        <Typography variant="body2" color="text.secondary">{t.filters.range}</Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={filters.range}
          onChange={(_e, v: OpsRange | null) => v && onChange({ range: v })}
          aria-label={t.filters.rangeAria}
          sx={{ display: 'flex' }}
        >
          {OPS_RANGES.map((r) => <ToggleButton key={r} value={r} sx={toggleSx}>{t.filters.ranges[r]}</ToggleButton>)}
        </ToggleButtonGroup>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
        <Typography variant="body2" color="text.secondary">{t.filters.resource}</Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={filters.resource}
          onChange={(_e, v: OpsResourceFilter | null) => v && onChange({ resource: v })}
          aria-label={t.filters.resourceAria}
          sx={{ display: 'flex' }}
        >
          {OPS_RESOURCE_FILTERS.map((r) => (
            <ToggleButton key={r} value={r} sx={toggleSx}>{t.filters.resources[r]}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <FormControlLabel
          sx={{ mr: 0 }}
          control={<Switch checked={filters.autoRefresh} onChange={(e) => onChange({ autoRefresh: e.target.checked })} />}
          label={<Typography variant="body2">{t.filters.autoRefresh}</Typography>}
        />
        <Tooltip title={t.filters.autoRefreshHint} enterTouchDelay={0}>
          <IconButton size="small" aria-label={t.filters.autoRefreshHint} sx={{ color: 'text.secondary' }}>
            <AppIcon icon={Info} size="sm" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Stack>
  );
}

interface ViewInput {
  latestRes: OpsLatest | null;
  series: OpsMetricsState['series'];
  resource: OpsResourceFilter;
  colors: ReturnType<typeof chartColors>;
}

/**
 * Tudo que os KPIs e os gráficos mostram, derivado só dos dados da API e do filtro de recurso.
 * Roda num `useMemo`: render por "buscando", anúncio ou relógio não reconstrói os 12 gráficos.
 */
function buildUsageView({ latestRes, series, resource, colors }: ViewInput) {
  const thresholds = latestRes?.thresholds;
  const latest = latestRes?.latest ?? [];
  const serversSeries = series.servers?.series ?? [];
  const dbSeries = series.database?.series ?? [];
  const workerSeries = series.workers?.series ?? [];
  const bucketS = series.servers?.bucketMinutes ?? 5;
  const bucketD = series.database?.bucketMinutes ?? 5;
  const bucketW = series.workers?.bucketMinutes ?? 5;

  // ---- Servidores ----
  const showApi = resourceVisible(resource, 'api');
  const showDb = resourceVisible(resource, 'postgres');
  const cpuApi = seriesPoints(serversSeries, 'cpu_pct', 'api');
  const cpuDb = seriesPoints(serversSeries, 'cpu_pct', 'postgres');
  const memApi = seriesPoints(serversSeries, 'memory_pct', 'api');
  const memDb = seriesPoints(serversSeries, 'memory_pct', 'postgres');
  const renderMissingData = cpuApi.length + cpuDb.length + memApi.length + memDb.length === 0 && dbSeries.some((s) => s.points.length > 0);

  const kpiValue = (metric: string, kind: 'api' | 'postgres' | undefined, pts: OpsSeriesPoint[]) =>
    latestValue(latest, metric, kind)?.value ?? lastAvg(pts);

  const ramApiV = kpiValue('memory_pct', 'api', memApi);
  const cpuApiV = kpiValue('cpu_pct', 'api', cpuApi);
  const ramDbV = kpiValue('memory_pct', 'postgres', memDb);
  const cpuDbV = kpiValue('cpu_pct', 'postgres', cpuDb);
  const connPts = seriesPoints(dbSeries, 'db_connections');
  const idleTxPts = seriesPoints(dbSeries, 'db_idle_in_transaction');
  const cachePts = seriesPoints(dbSeries, 'db_cache_hit_pct');
  const connV = kpiValue('db_connections', undefined, connPts);
  const idleTxV = kpiValue('db_idle_in_transaction', undefined, idleTxPts);
  const cacheV = kpiValue('db_cache_hit_pct', undefined, cachePts);
  const spark = (pts: OpsSeriesPoint[]) => pts.map((p) => p.avg);

  const tiles: (UsageKpiTileProps & { key: string; visible: boolean })[] = [
    {
      key: 'ramApi', visible: showApi, label: t.kpi.ramApi, icon: MemoryStick, value: formatPct(ramApiV),
      context: ramApiV != null ? t.kpi.ofMb(Math.round((ramApiV / 100) * API_MEMORY_LIMIT_MB), API_MEMORY_LIMIT_MB) : undefined,
      status: thresholds ? statusFor(ramApiV, thresholds.memoryPct) : 'noData', help: t.help.memory_pct,
      spark: spark(memApi), sparkColor: colors.api, formatValue: formatPct,
    },
    {
      key: 'cpuApi', visible: showApi, label: t.kpi.cpuApi, icon: Cpu, value: formatPct(cpuApiV), context: t.kpi.avg5min,
      status: thresholds ? statusFor(cpuApiV, thresholds.cpuPct) : 'noData', help: t.help.cpu_pct,
      spark: spark(cpuApi), sparkColor: colors.api, formatValue: formatPct,
    },
    {
      key: 'ramDb', visible: showDb, label: t.kpi.ramDb, icon: MemoryStick, value: formatPct(ramDbV),
      status: thresholds ? statusFor(ramDbV, thresholds.memoryPct) : 'noData', help: t.help.memory_pct,
      spark: spark(memDb), sparkColor: colors.postgres, formatValue: formatPct,
    },
    {
      key: 'cpuDb', visible: showDb, label: t.kpi.cpuDb, icon: Cpu, value: formatPct(cpuDbV), context: t.kpi.avg5min,
      status: thresholds ? statusFor(cpuDbV, thresholds.cpuPct) : 'noData', help: t.help.cpu_pct,
      spark: spark(cpuDb), sparkColor: colors.postgres, formatValue: formatPct,
    },
    {
      key: 'connections', visible: true, label: t.kpi.connections, icon: Database,
      value: connV != null ? formatNumber(connV) : '—',
      context: idleTxV != null ? t.kpi.idleInTx(Math.round(idleTxV)) : undefined,
      // Status vem das ociosas em transação: sem esse valor (ou sem limiar) não há como julgar.
      status: connV == null || idleTxV == null || !thresholds ? 'noData' : statusFor(idleTxV, thresholds.idleInTransaction),
      help: t.help.db_connections, spark: spark(connPts), sparkColor: colors.postgres, formatValue: fmtCount,
    },
    {
      key: 'cacheHit', visible: true, label: t.kpi.cacheHit, icon: Gauge, value: formatPct(cacheV), context: t.kpi.cacheIdeal,
      status: cacheHitStatus(cacheV), help: t.help.db_cache_hit_pct, spark: spark(cachePts), sparkColor: colors.postgres,
      formatValue: formatPct,
    },
  ];

  const serverLines = (apiPts: OpsSeriesPoint[], dbPts: OpsSeriesPoint[], bucket: number) => {
    const list = [...(showApi ? [{ key: 'api', label: t.charts.series.api, color: colors.api, pts: apiPts }] : []),
      ...(showDb ? [{ key: 'postgres', label: t.charts.series.postgres, color: colors.postgres, pts: dbPts }] : [])]
      .filter((x) => x.pts.length > 0);
    const aligned = alignSeries(list.map((x) => x.pts), bucket);
    const lines: LineSpec[] = list.map((x, i) => ({
      id: x.key, label: x.label, color: x.color, values: avgOf(aligned.rows[i]),
      band: { min: minOf(aligned.rows[i]), max: maxOf(aligned.rows[i]) }, format: formatPct,
    }));
    const table = buildTable(aligned.times, list.map((x, i) => ({ label: x.label, rows: aligned.rows[i], format: formatPct })));
    return { aligned, lines, table, list };
  };
  const cpu = serverLines(cpuApi, cpuDb, bucketS);
  const mem = serverLines(memApi, memDb, bucketS);
  const memApiIdx = mem.list.findIndex((x) => x.key === 'api');

  // ---- Banco de dados ----
  const activePts = seriesPoints(dbSeries, 'db_active');
  const idlePts = seriesPoints(dbSeries, 'db_idle');
  const maxAgePts = seriesPoints(dbSeries, 'db_idle_in_transaction_max_age_s');
  const commitPts = seriesPoints(dbSeries, 'db_xact_commit');
  const connAligned = alignSeries([activePts, idlePts, idleTxPts, connPts], bucketD);
  const connSpecs = [
    { id: 'active', label: t.charts.series.active, color: colors.active },
    { id: 'idle', label: t.charts.series.idle, color: colors.idle },
    { id: 'idleInTx', label: t.charts.series.idleInTx, color: colors.idleInTx },
  ];
  const connLines: LineSpec[] = connSpecs.map((c, i) => ({
    ...c, values: avgOf(connAligned.rows[i]), stacked: true, format: fmtCount,
  }));
  const connTotals = avgOf(connAligned.rows[3]);
  const connEmpty = connLines.every((l) => l.values.every((v) => v == null));

  const idleAligned = alignSeries([idleTxPts, maxAgePts], bucketD);
  const idleValues = maxOf(idleAligned.rows[0]);
  const cacheAligned = alignSeries([cachePts], bucketD);
  const cacheValues = avgOf(cacheAligned.rows[0]);
  const commitAligned = alignSeries([commitPts], bucketD);
  const commitRates = counterRatePerMinute(commitAligned.rows[0], commitAligned.times);

  const rollbacks = counterPeriodTotal(seriesPoints(dbSeries, 'db_xact_rollback'));
  const deadlocks = counterPeriodTotal(seriesPoints(dbSeries, 'db_deadlocks'));
  const tempBytes = counterPeriodTotal(seriesPoints(dbSeries, 'db_temp_bytes'));

  // ---- Workers ----
  const heartbeat = latestRes ? hasHeartbeat(latestRes.workers) : false;
  const rssByWorker = seriesByResource(workerSeries, 'rss_mb');
  const loopByWorker = seriesByResource(workerSeries, 'event_loop_p99_ms');
  const cpuByWorker = seriesByResource(workerSeries, 'node_cpu_pct');
  const workerLines = (byWorker: { resource: string; points: OpsSeriesPoint[] }[], format: (v: number) => string) => {
    const aligned = alignSeries(byWorker.map((w) => w.points), bucketW);
    const lines: LineSpec[] = byWorker.slice(0, MAX_WORKERS_IN_CHART).map((w, i) => ({
      id: `w${i}`, label: w.resource, color: colors.ordered[i], values: avgOf(aligned.rows[i]),
      band: byWorker.length === 1 ? { min: minOf(aligned.rows[i]), max: maxOf(aligned.rows[i]) } : undefined, format,
    }));
    return { aligned, lines };
  };
  const rssW = workerLines(rssByWorker, fmtMb);
  const loopW = workerLines(loopByWorker, fmtMs);
  const cpuAlignedByWorker = rssByWorker.map((w) => {
    const c = cpuByWorker.find((x) => x.resource === w.resource);
    const byAt = new Map((c?.points ?? []).map((p) => [new Date(p.at).getTime(), p.avg]));
    return (i: number) => {
      const v = byAt.get(rssW.aligned.times[i]);
      return v == null ? '—' : formatPct(v);
    };
  });


  // Itens que antes nasciam no JSX: memoizados aqui para o `useMemo` do gráfico não recalcular a cada render.
  const memExtras: TooltipExtra[] = memApiIdx >= 0 ? [{
    id: 'memApiMb',
    label: t.charts.series.api,
    text: (i) => {
      const p = mem.aligned.rows[memApiIdx][i];
      return p ? t.charts.memoryMb(formatNumber(Math.round((p.avg / 100) * API_MEMORY_LIMIT_MB))) : null;
    },
  }] : [];
  const connExtras: TooltipExtra[] = [
    { id: 'connTotal', label: t.charts.series.total, text: (i) => (connTotals[i] == null ? null : fmtCount(connTotals[i] as number)) },
    {
      id: 'connOther',
      label: t.charts.series.other,
      text: (i) => {
        const total = connTotals[i];
        if (total == null) return null;
        const sum = connLines.reduce((a, l) => a + (l.values[i] ?? 0), 0);
        return total - sum > 0.5 ? fmtCount(total - sum) : null;
      },
    },
  ];
  const connTable = buildTable(connAligned.times, connSpecs.map((c, i) => ({ label: c.label, rows: connAligned.rows[i], format: fmtCount })));
  const idleLines: LineSpec[] = [{ id: 'idleTx', label: t.charts.idleInTx, color: colors.idleInTx, values: idleValues, format: fmtCount }];
  const idleExtras: TooltipExtra[] = [{
    id: 'oldest',
    label: t.charts.series.idleInTx,
    text: (i) => {
      const p = idleAligned.rows[1][i];
      return p && p.max > 0 ? t.charts.oldestIdle(Math.round(p.max)) : null;
    },
  }];
  const idleTable = buildTable(idleAligned.times, [{ label: t.charts.idleInTx, rows: idleAligned.rows[0], format: fmtCount }]);
  const cacheLines: LineSpec[] = [{
    id: 'cache', label: t.charts.cacheHit, color: colors.postgres, values: cacheValues,
    band: { min: minOf(cacheAligned.rows[0]), max: maxOf(cacheAligned.rows[0]) }, format: formatPct,
  }];
  const cacheMin = cacheHitDomainMin(minOf(cacheAligned.rows[0]));
  const cacheTable = buildTable(cacheAligned.times, [{ label: t.charts.cacheHit, rows: cacheAligned.rows[0], format: formatPct }]);
  const commitTable: ChartTable = {
    headers: [t.charts.tableCols.time, t.charts.commits],
    rows: commitAligned.times
      .map((ms, i) => [formatDateTime(ms), commitRates[i] == null ? '—' : formatNumber(commitRates[i] as number, 1)])
      .reverse(),
  };
  const rssTable = buildTable(
    rssW.aligned.times,
    rssByWorker.map((w, i) => ({ label: w.resource, rows: rssW.aligned.rows[i], format: fmtMb, extra: cpuAlignedByWorker[i] })),
    t.charts.tableCols.cpu,
  );
  const loopTable = buildTable(loopW.aligned.times, loopByWorker.map((w, i) => ({ label: w.resource, rows: loopW.aligned.rows[i], format: fmtMs })));

  return {
    tiles, cpu, mem, memExtras, renderMissingData, connAligned, connLines, connTotals, connEmpty, connExtras, connTable,
    idleTxPts, idleValues, idleAligned, idleLines, idleExtras, idleTable, cachePts, cacheAligned, cacheValues, cacheLines, cacheMin,
    cacheTable, commitAligned, commitRates, commitTable, rollbacks, deadlocks, tempBytes, heartbeat, rssByWorker,
    loopByWorker, rssW, loopW, rssTable, loopTable,
  };
}

/** Aba Consumo de Workers (carregada sob demanda). Dado de infraestrutura: sem tenant, sem PII. */
export default function UsageTab({ headerSlot }: { headerSlot?: HTMLElement | null }) {
  const theme = useTheme();
  const mode = theme.palette.mode;
  const colors = useMemo(() => chartColors(mode), [mode]);
  const [filters, setFilters] = usePersistedState<UsageFilters>(USAGE_FILTERS_KEY, DEFAULT_USAGE_FILTERS, FILTER_PERSIST);
  const m = useOpsMetrics(filters.range, filters.autoRefresh);
  const [announce, setAnnounce] = useState('');

  const thresholds = m.latest?.thresholds;
  const latest = m.latest?.latest ?? [];
  const serversSeries = m.series.servers?.series ?? [];
  const dbSeries = m.series.database?.series ?? [];
  const workerSeries = m.series.workers?.series ?? [];
  const allSeries: OpsSeries[] = [...serversSeries, ...dbSeries, ...workerSeries];
  const newestAt = newestSampleAt(latest, allSeries);
  const hasSamples = latest.length > 0 || allSeries.some((s) => s.points.length > 0);
  const samplerActive = m.latest ? m.latest.samplerActive : null;
  const now = serverNow();
  const view = useMemo(
    () => buildUsageView({ latestRes: m.latest, series: m.series, resource: filters.resource, colors }),
    [m.latest, m.series, filters.resource, colors],
  );

  const onChange = (patch: Partial<UsageFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const manualRefresh = () => {
    setAnnounce('');
    void m.reload().then((ok) => { if (ok) setAnnounce(t.header.refreshed); });
  };
  const retry = () => void m.reload();

  const header = (
    <UsageHeader samplerActive={samplerActive} newestAt={newestAt} fetching={m.fetching} onRefresh={manualRefresh} />
  );
  const live = (
    <Box component="span" aria-live="polite" sx={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
      {announce}
    </Box>
  );
  const top = (
    <>
      {headerSlot ? createPortal(header, headerSlot) : <Box sx={{ mb: 1 }}>{header}</Box>}
      {live}
      <Filters filters={filters} onChange={onChange} />
    </>
  );

  // 1ª carga falhou inteira.
  const allFailed = m.errors.latest && m.errors.servers && m.errors.database && m.errors.workers;
  if (!m.loading && allFailed && !m.latest) {
    return (
      <Box>
        {top}
        <Alert severity="error" sx={{ mt: 3 }} action={<Button color="inherit" size="small" onClick={retry}>{t.retry}</Button>}>
          {t.loadFailed}
        </Alert>
      </Box>
    );
  }

  if (!m.loading && m.latest && !m.latest.samplerActive && !hasSamples) {
    return <Box>{top}<CollectionOffState /></Box>;
  }

  const loading = m.loading;
  const {
    tiles, cpu, mem, memExtras, renderMissingData, connAligned, connLines, connTotals, connEmpty, connExtras, connTable,
    idleTxPts, idleValues, idleAligned, idleLines, idleExtras, idleTable, cachePts, cacheAligned, cacheValues, cacheLines, cacheMin,
    cacheTable, commitAligned, commitRates, commitTable, rollbacks, deadlocks, tempBytes, heartbeat, rssByWorker,
    loopByWorker, rssW, loopW, rssTable, loopTable,
  } = view;
  const renderMissing = !loading && renderMissingData;

  const newestAge = newestAt ? formatRelativeTime(newestAt, now, t.header.justNow) : '';

  return (
    <Box>
      {top}

      {m.refreshError && <Alert severity="warning" sx={{ mt: 2 }}>{t.refreshFailed}</Alert>}
      {m.latest && !m.latest.samplerActive && hasSamples && newestAt && (
        <Alert severity="warning" sx={{ mt: 2 }}>{t.off.stopped(formatDateTime(newestAt))}</Alert>
      )}
      {m.latest?.samplerActive && isStale(newestAt, now) && (
        <Alert severity="warning" sx={{ mt: 2 }}>{t.off.stale(newestAge)}</Alert>
      )}

      <Grid container spacing={2} sx={{ mt: 1 }}>
        {tiles.filter((k) => k.visible).map(({ key, visible: _v, ...tile }) => (
          <Grid item xs={6} sm={4} lg={2} key={key}>
            {loading ? <Skeleton variant="rounded" height={170} /> : <UsageKpiTile {...tile} />}
          </Grid>
        ))}
      </Grid>

      <SectionTitle>{t.sections.servers}</SectionTitle>
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <MetricChartCard
            title={t.charts.cpu}
            unit={t.charts.cpuUnit}
            help={t.help.cpu_pct}
            note={t.charts.cpuNote}
            loading={loading}
            error={m.errors.servers}
            onRetry={retry}
            empty={cpu.lines.length === 0}
            emptyText={renderMissing ? t.charts.renderMissing : undefined}
            figureAria={figureAria(t.charts.cpu, cpu.lines.flatMap((l) => l.values), formatPct, thresholds && formatPct(thresholds.cpuPct))}
            table={cpu.table}
          >
            <TimeLineChart
              times={cpu.aligned.times}
              range={filters.range}
              lines={cpu.lines}
              yMin={0}
              yMax={100}
              reference={thresholds && { y: thresholds.cpuPct, label: t.charts.threshold(formatPct(thresholds.cpuPct)) }}
            />
          </MetricChartCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <MetricChartCard
            title={t.charts.memory}
            unit={t.charts.memoryUnit}
            help={t.help.memory_pct}
            loading={loading}
            error={m.errors.servers}
            onRetry={retry}
            empty={mem.lines.length === 0}
            emptyText={renderMissing ? t.charts.renderMissing : undefined}
            figureAria={figureAria(t.charts.memory, mem.lines.flatMap((l) => l.values), formatPct, thresholds && formatPct(thresholds.memoryPct))}
            table={mem.table}
          >
            <TimeLineChart
              times={mem.aligned.times}
              range={filters.range}
              lines={mem.lines}
              yMin={0}
              yMax={100}
              reference={thresholds && { y: thresholds.memoryPct, label: t.charts.threshold(formatPct(thresholds.memoryPct)) }}
              extras={memExtras}
            />
          </MetricChartCard>
        </Grid>
      </Grid>

      <SectionTitle>{t.sections.database}</SectionTitle>
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <MetricChartCard
            title={t.charts.connections}
            unit={t.charts.connectionsUnit}
            help={t.help.db_connections}
            loading={loading}
            error={m.errors.database}
            onRetry={retry}
            empty={connEmpty}
            figureAria={figureAria(t.charts.connections, connTotals, fmtCount)}
            table={connTable}
          >
            <TimeLineChart
              times={connAligned.times}
              range={filters.range}
              lines={connLines}
              yMin={0}
              yMax={countDomainMax(connTotals)}
              extras={connExtras}
            />
          </MetricChartCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <MetricChartCard
            title={t.charts.idleInTx}
            unit={t.charts.idleInTxUnit}
            help={t.help.db_idle_in_transaction}
            loading={loading}
            error={m.errors.database}
            onRetry={retry}
            empty={idleTxPts.length === 0}
            figureAria={figureAria(t.charts.idleInTx, idleValues, fmtCount, thresholds && fmtCount(thresholds.idleInTransaction))}
            table={idleTable}
          >
            <TimeLineChart
              times={idleAligned.times}
              range={filters.range}
              lines={idleLines}
              yMin={0}
              yMax={countDomainMax(idleValues, thresholds?.idleInTransaction)}
              reference={thresholds && { y: thresholds.idleInTransaction, label: t.charts.threshold(fmtCount(thresholds.idleInTransaction)) }}
              extras={idleExtras}
            />
          </MetricChartCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <MetricChartCard
            title={t.charts.cacheHit}
            unit={t.charts.cacheHitUnit}
            help={t.help.db_cache_hit_pct}
            loading={loading}
            error={m.errors.database}
            onRetry={retry}
            empty={cachePts.length === 0}
            figureAria={figureAria(t.charts.cacheHit, cacheValues, formatPct)}
            table={cacheTable}
          >
            <TimeLineChart
              times={cacheAligned.times}
              range={filters.range}
              lines={cacheLines}
              yMin={cacheMin}
              yMax={100}
              reference={{ y: 99, label: t.charts.ideal(formatPct(99)) }}
            />
          </MetricChartCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <MetricChartCard
            title={t.charts.commits}
            unit={t.charts.commitsUnit}
            help={t.help.db_xact_commit}
            loading={loading}
            error={m.errors.database}
            onRetry={retry}
            empty={commitRates.every((v) => v == null)}
            figureAria={figureAria(t.charts.commits, commitRates, (v) => formatNumber(v, 1))}
            table={commitTable}
          >
            <CommitsBarChart
              times={commitAligned.times}
              values={commitRates}
              range={filters.range}
              label={t.charts.commits}
              color={colors.active}
            />
          </MetricChartCard>
        </Grid>
      </Grid>

      {!loading && !m.errors.database && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={{ xs: 1, sm: 3 }}
          sx={{ mt: 2, alignItems: { sm: 'center' }, flexWrap: 'wrap' }}
          aria-label={t.sections.database}
        >
          <Typography variant="body2" color="text.secondary">
            {t.counters.rollbacks}{' '}
            <Box component="strong" sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
              {rollbacks == null ? '—' : formatNumber(rollbacks)}
            </Box>
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {t.counters.deadlocks}{' '}
              <Box component="strong" sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
                {deadlocks == null ? '—' : formatNumber(deadlocks)}
              </Box>
            </Typography>
            {deadlocks != null && deadlocks > 0 && (
              <Tooltip title={t.help.db_deadlocks} enterTouchDelay={0}>
                <Chip
                  size="small"
                  color="warning"
                  variant="outlined"
                  tabIndex={0}
                  icon={<AppIcon icon={TriangleAlert} size="sm" aria-hidden />}
                  label={t.status.warning}
                />
              </Tooltip>
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t.counters.tempFiles}{' '}
            <Box component="strong" sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
              {formatBytes(tempBytes)}
            </Box>
          </Typography>
        </Stack>
      )}

      <Box sx={{ mt: 2 }}>
        {loading ? (
          <Skeleton variant="rounded" height={240} />
        ) : m.errors.latest ? (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={retry}>{t.retry}</Button>}>
            {t.charts.error}
          </Alert>
        ) : (
          <TopQueriesTable
            queries={m.latest?.topQueries ?? []}
            snapshotLabel={m.latest?.topQueries[0]
              ? t.queries.snapshot(formatRelativeTime(m.latest.topQueries[0].at, now, t.header.justNow))
              : undefined}
          />
        )}
      </Box>

      <SectionTitle>{t.sections.workers}</SectionTitle>
      {!loading && m.latest && !heartbeat ? (
        <Alert
          severity="info"
          icon={<AppIcon icon={Server} size="md" />}
          sx={{ alignItems: 'center' }}
          action={(
            <Tooltip title={t.workers.adoptionOffHint} enterTouchDelay={0}>
              <IconButton size="small" color="inherit" aria-label={t.workers.adoptionOffHintAria}>
                <AppIcon icon={Info} size="sm" />
              </IconButton>
            </Tooltip>
          )}
        >
          {t.workers.adoptionOff}
        </Alert>
      ) : (
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <MetricChartCard
              title={t.charts.workerMemory}
              unit={t.charts.workerMemoryUnit}
              help={t.help.rss_mb}
              loading={loading}
              error={m.errors.workers}
              onRetry={retry}
              empty={rssByWorker.length === 0}
              figureAria={figureAria(t.charts.workerMemory, rssW.lines.flatMap((l) => l.values), fmtMb)}
              tableOnlyNotice={rssByWorker.length > MAX_WORKERS_IN_CHART ? t.charts.tooManyWorkers : undefined}
              table={rssTable}
            >
              <TimeLineChart times={rssW.aligned.times} range={filters.range} lines={rssW.lines} yMin={0} />
            </MetricChartCard>
          </Grid>
          <Grid item xs={12} md={6}>
            <MetricChartCard
              title={t.charts.eventLoop}
              unit={t.charts.eventLoopUnit}
              help={t.help.event_loop_p99_ms}
              loading={loading}
              error={m.errors.workers}
              onRetry={retry}
              empty={loopByWorker.length === 0}
              figureAria={figureAria(t.charts.eventLoop, loopW.lines.flatMap((l) => l.values), fmtMs, thresholds && fmtMs(thresholds.eventLoopP99Ms))}
              tableOnlyNotice={loopByWorker.length > MAX_WORKERS_IN_CHART ? t.charts.tooManyWorkers : undefined}
              table={loopTable}
            >
              <TimeLineChart
                times={loopW.aligned.times}
                range={filters.range}
                lines={loopW.lines}
                yMin={0}
                yMax={countDomainMax(loopW.lines.flatMap((l) => l.values), thresholds?.eventLoopP99Ms)}
                reference={thresholds && { y: thresholds.eventLoopP99Ms, label: t.charts.threshold(fmtMs(thresholds.eventLoopP99Ms)) }}
              />
            </MetricChartCard>
          </Grid>
        </Grid>
      )}
    </Box>
  );
}
