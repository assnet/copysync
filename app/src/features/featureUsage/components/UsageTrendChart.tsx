import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Box, Card, Divider, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, ToggleButton,
  Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';
import type { LineSeriesType } from '@mui/x-charts/models';
import { ChartLine, Table2 } from 'lucide-react';
import { AppIcon } from '@/components';
import { chartColors } from '@/features/opsMetrics/chartColors';
import { bucketLabel, bucketTick, featureLabel, formatCount, formatInteger, previousUsesPerBucket } from '../rules';
import { featureUsageStrings as S } from '../strings';
import type {
  UsageFeatureItem, UsageFeatureSeriesPoint, UsageGranularity, UsageSummarySeriesPoint,
} from '../types';
import { UsageRetryAlert } from './UsageSummaryGate';

const t = S.trend;
const PREVIOUS_ID = 'previous';

/** O que a linha mostra: contas ativas no geral, ou usos e contas de um recurso (com a série dele). */
export type UsageTrendData =
  | { type: 'overall'; series: readonly UsageSummarySeriesPoint[] }
  | { type: 'feature'; feature: Pick<UsageFeatureItem, 'key' | 'usesPrevious'>; series: readonly UsageFeatureSeriesPoint[] };

interface Props {
  granularity: UsageGranularity;
  /** `null` enquanto a série do recurso carrega. */
  data: UsageTrendData | null;
  error?: boolean;
  slow?: boolean;
  onRetry?: () => void;
  /** Escolha do que mostrar (geral ou um recurso), no cabeçalho do cartão. */
  control?: ReactNode;
}

interface TrendModel {
  buckets: string[];
  lines: { id: string; label: string; values: number[]; color: string; axis: 'left' | 'right'; dashed?: boolean }[];
  /** Média por intervalo do período anterior (só com recurso e base). */
  previous: number | null;
  headers: string[];
  rows: string[][];
}

function buildModel(data: UsageTrendData, granularity: UsageGranularity, colors: ReturnType<typeof chartColors>): TrendModel {
  const buckets = data.series.map((p) => p.bucket);
  if (data.type === 'overall') {
    const values = data.series.map((p) => p.activeTenants);
    return {
      buckets,
      lines: [{ id: 'activeTenants', label: t.activeTenantsSeries, values, color: colors.ordered[0], axis: 'left' }],
      previous: null,
      headers: [t.bucketColumn, t.activeTenantsSeries],
      rows: data.series.map((p) => [bucketLabel(p.bucket, granularity), formatInteger(p.activeTenants)]),
    };
  }
  const previous = previousUsesPerBucket(data.feature, data.series.length);
  const uses = data.series.map((p) => p.uses);
  const lines: TrendModel['lines'] = [
    { id: 'uses', label: t.usesSeries, values: uses, color: colors.ordered[0], axis: 'left' },
    { id: 'tenants', label: t.tenantsSeries, values: data.series.map((p) => p.activeTenants), color: colors.ordered[1], axis: 'right' },
  ];
  if (previous !== null) {
    lines.push({ id: PREVIOUS_ID, label: t.previousSeries, values: data.series.map(() => previous), color: colors.other, axis: 'left', dashed: true });
  }
  const headers = [t.bucketColumn, t.usesSeries, t.tenantsSeries, ...(previous !== null ? [t.previousSeries] : [])];
  const rows = data.series.map((p) => [
    bucketLabel(p.bucket, granularity),
    formatInteger(p.uses),
    formatInteger(p.activeTenants),
    ...(previous !== null ? [formatCount(Math.round(previous * 10) / 10)] : []),
  ]);
  return { buckets, lines, previous, headers, rows };
}

/**
 * Tendência (chunk próprio, `lazy`): linha por intervalo (dia/semana/mês). Sem recurso, contas ativas; com recurso,
 * usos (eixo da esquerda) e contas (eixo da direita), e a média do período anterior tracejada quando há base.
 * Alternância gráfico ↔ tabela com os mesmos números.
 */
export default function UsageTrendChart({ granularity, data, error, slow, onRetry, control }: Props) {
  const theme = useTheme();
  const small = useMediaQuery(theme.breakpoints.down('md'));
  const [showTable, setShowTable] = useState(false);
  const plotRef = useRef<HTMLDivElement>(null);
  const mode = theme.palette.mode;
  const model = useMemo(() => (data ? buildModel(data, granularity, chartColors(mode)) : null), [data, granularity, mode]);
  const empty = !!model && (model.buckets.length === 0 || model.lines.every((l) => l.id === PREVIOUS_ID || l.values.every((v) => v === 0)));
  const canToggle = !!model && !empty && !error && !slow;
  const asTable = canToggle && showTable;
  useEffect(() => {
    plotRef.current?.querySelectorAll('svg').forEach((svg) => svg.setAttribute('tabindex', '-1'));
  });

  const subtitle = data?.type === 'feature' ? t.subtitleFeature(featureLabel(data.feature.key)) : t.subtitleOverall;
  const hasRight = model?.lines.some((l) => l.axis === 'right') ?? false;

  let body: ReactNode;
  if ((error || slow) && onRetry) {
    body = <UsageRetryAlert slow={!!slow} onRetry={onRetry} message={S.errors.detailFailed} />;
  } else if (!model) {
    body = <Skeleton variant="rounded" sx={{ height: { xs: 200, md: 240 } }} aria-label={S.states.loading} />;
  } else if (empty) {
    body = <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>{t.empty}</Typography>;
  } else if (asTable) {
    body = (
      <TableContainer sx={{ maxHeight: 280 }}>
        <Table size="small" stickyHeader aria-label={t.tableAria}>
          <TableHead>
            <TableRow>
              {model.headers.map((h, i) => <TableCell key={h} align={i === 0 ? 'left' : 'right'}>{h}</TableCell>)}
            </TableRow>
          </TableHead>
          <TableBody>
            {model.rows.map((row, ri) => (
              <TableRow key={model.buckets[ri]}>
                {row.map((c, i) => (
                  <TableCell key={i} align={i === 0 ? 'left' : 'right'} sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {c}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  } else {
    const series: LineSeriesType[] = model.lines.map((l) => ({
      type: 'line',
      id: l.id,
      label: l.label,
      data: l.values,
      color: l.color,
      yAxisId: l.axis,
      curve: 'linear',
      showMark: !l.dashed && model.buckets.length <= 1,
      valueFormatter: (v: number | null) => (v == null ? null : l.dashed ? formatCount(Math.round(v * 10) / 10) : formatInteger(v)),
    }));
    body = (
      <Box component="figure" role="group" aria-label={t.aria} sx={{ m: 0 }}>
        <Box aria-hidden ref={plotRef}>
          <LineChart
            height={small ? 200 : 240}
            skipAnimation
            series={series}
            xAxis={[{
              data: model.buckets,
              scaleType: 'point',
              valueFormatter: (v: string, ctx) => (ctx.location === 'tick' ? bucketTick(v, granularity) : bucketLabel(v, granularity)),
            }]}
            yAxis={[
              { id: 'left', width: 44, min: 0, valueFormatter: (v: number) => formatCount(v) },
              ...(hasRight ? [{ id: 'right', position: 'right' as const, width: 36, min: 0, valueFormatter: (v: number) => formatCount(v) }] : []),
            ]}
            grid={{ horizontal: true }}
            slotProps={{ legend: { position: { vertical: 'top', horizontal: 'start' } }, tooltip: { trigger: 'axis' } }}
            hideLegend={model.lines.length < 2}
            // Margem à direita: o último rótulo do eixo X ("17/11") é centrado no ponto e seria cortado ("1…").
            margin={{ top: 8, right: hasRight ? 0 : 28, bottom: 0, left: 0 }}
            sx={{
              '& .MuiChartsGrid-line': { stroke: theme.palette.divider },
              '& .MuiLineElement-root': { strokeWidth: 2 },
              [`& path[data-series="${PREVIOUS_ID}"]`]: { strokeDasharray: '6 4', strokeWidth: 1.5 },
            }}
          />
        </Box>
        {model.previous !== null && (
          <Typography variant="caption" color="text.secondary" component="figcaption" sx={{ mt: 0.5 }}>
            {t.previousHint}
          </Typography>
        )}
      </Box>
    );
  }

  const toggleLabel = showTable ? S.actions.showChart : S.actions.showTable;
  return (
    <Card component="section" aria-label={t.title} sx={{ height: '100%' }}>
      <Stack spacing={1} sx={{ px: 2.5, pt: 2, pb: 1.5 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" component="h3">{t.title}</Typography>
            <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
          </Box>
          {canToggle && (
            <Tooltip title={toggleLabel}>
              <ToggleButton
                value="table"
                size="small"
                selected={showTable}
                onChange={() => setShowTable((v) => !v)}
                aria-label={toggleLabel}
                sx={{ minWidth: 40, minHeight: { xs: 40, sm: 32 } }}
              >
                <AppIcon icon={showTable ? ChartLine : Table2} size="sm" />
              </ToggleButton>
            </Tooltip>
          )}
        </Stack>
        {control}
      </Stack>
      <Divider />
      <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 2 }}>{body}</Box>
    </Card>
  );
}
