import { lazy, Suspense, useId, useMemo, type ReactNode } from 'react';
import {
  Alert, Box, Button, Chip, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
  useMediaQuery, useTheme,
} from '@mui/material';
import { ChartLine, Table2 } from 'lucide-react';
import { AppIcon, SectionCard } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { chartColors } from '@/features/opsMetrics/chartColors';
import { HelpTip } from '@/features/opsMetrics/components/HelpTip';
import { srOnly } from '@/features/infraCosts/components/costParts';
import {
  bucketLabel, bucketTick, coverageTexts, featureDataSince, featureLabel, featureUsesTrend, formatCount, formatDay,
  formatInteger, formatReach, formatTenantsComparison, formatTrend, formatUsesComparison, kindLabel, planLabel,
  trendTone,
} from '../rules';
import { featureUsageStrings as S } from '../strings';
import type { UsageFeatureDetail } from '../types';

/** x-charts em chunk próprio: medidas e tabelas não esperam o gráfico. */
const LineChart = lazy(() => import('@mui/x-charts/LineChart').then((mod) => ({ default: mod.LineChart })));

const m = S.measures;
const numCell = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;
const toneColor = { success: 'success.main', warning: 'warning.main', neutral: 'text.secondary' } as const;

function Measure({ label, help, value, context, contextColor }: {
  label: string; help: string; value: ReactNode; context?: string; contextColor?: string;
}) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: 'text.secondary' }}>
        <Typography variant="body2" component="h4" sx={{ fontWeight: 600, minWidth: 0 }}>{label}</Typography>
        <HelpTip label={label} text={help} />
      </Stack>
      <Typography variant="h6" component="p" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
      {context && (
        <Typography variant="caption" component="p" sx={{ color: contextColor ?? 'text.secondary' }}>{context}</Typography>
      )}
    </Box>
  );
}

/** Esqueleto no formato do detalhe (medidas + gráfico). */
export function FeatureDetailSkeleton() {
  return (
    <Stack spacing={2} role="status" aria-label={S.detail.loading}>
      <Skeleton variant="rounded" height={140} />
      <Skeleton variant="rounded" height={300} />
    </Stack>
  );
}

function SeriesChart({ detail, tableId }: { detail: UsageFeatureDetail; tableId: string }) {
  const theme = useTheme();
  const small = useMediaQuery(theme.breakpoints.down('sm'));
  const colors = chartColors(theme.palette.mode);
  const { granularity } = detail.range;
  // Um ponto só não forma linha: sem o marcador o gráfico fica vazio.
  const showMark = detail.series.length <= 1;
  const series = useMemo(() => [
    { id: 'uses', label: S.trend.usesSeries, color: colors.ordered[0], data: detail.series.map((p) => p.uses), showMark },
    { id: 'tenants', label: S.trend.tenantsSeries, color: colors.ordered[1], data: detail.series.map((p) => p.activeTenants), showMark },
  ], [detail.series, colors.ordered, showMark]);
  return (
    <Box component="figure" aria-label={S.trend.aria} aria-describedby={tableId} sx={{ m: 0, minWidth: 0 }}>
      <Suspense fallback={<Skeleton variant="rounded" height={small ? 220 : 280} />}>
      <LineChart
        aria-hidden
        focusable="false"
        tabIndex={-1}
        height={small ? 220 : 280}
        skipAnimation
        series={series}
        xAxis={[{
          data: detail.series.map((p) => p.bucket),
          scaleType: 'point',
          valueFormatter: (v: string, ctx) => (ctx.location === 'tick' ? bucketTick(v, granularity) : bucketLabel(v, granularity)),
        }]}
        yAxis={[{ width: 48, min: 0, valueFormatter: (v: number) => formatCount(v) }]}
        grid={{ horizontal: true }}
        slotProps={{ legend: { position: { vertical: 'top', horizontal: 'start' } }, tooltip: { trigger: 'axis' } }}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        sx={{ '& .MuiChartsGrid-line': { stroke: theme.palette.divider } }}
      />
      </Suspense>
    </Box>
  );
}

function SeriesTable({ detail, id, hidden }: { detail: UsageFeatureDetail; id: string; hidden: boolean }) {
  const { granularity } = detail.range;
  return (
    <TableContainer id={id} sx={hidden ? srOnly : undefined}>
      <Table size="small" aria-label={S.trend.tableAria}>
        <TableHead>
          <TableRow>
            <TableCell>{S.trend.bucketColumn}</TableCell>
            <TableCell align="right">{S.trend.usesSeries}</TableCell>
            <TableCell align="right">{S.trend.tenantsSeries}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {detail.series.map((p) => (
            <TableRow key={p.bucket}>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{bucketLabel(p.bucket, granularity)}</TableCell>
              <TableCell align="right" sx={numCell}>{formatInteger(p.uses)}</TableCell>
              <TableCell align="right" sx={numCell}>{formatInteger(p.activeTenants)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}


/**
 * Corpo do detalhe de um recurso: medidas do período (com comparação), aviso de contagem parcial, série de usos e
 * contas (gráfico ou tabela, escolha guardada por aba), quebra por tipo (só com mais de um tipo) e por plano na
 * família do recurso. Não há dado de conta aqui: nomes ficam na lista de contas.
 */
export function FeatureDetail({ detail }: { detail: UsageFeatureDetail }) {
  const f = detail.feature;
  const label = featureLabel(f.key);
  const trend = featureUsesTrend(f);
  const tableId = useId();
  const [view, setView] = usePersistedState<'chart' | 'table'>('usage.detail.seriesView', 'chart', { scope: 'tab' });
  const asTable = view === 'table';
  const partial = f.coverage === 'PARTIAL' ? coverageTexts(f) : [];
  const noSeries = detail.series.every((p) => p.uses === 0);

  return (
    <Stack spacing={2}>
      <SectionCard title={S.detail.measuresTitle}>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(5, minmax(0, 1fr))' } }}>
          <Measure label={m.uses.label} help={m.uses.help} value={formatInteger(f.uses)} context={formatUsesComparison(f.uses, f.usesPrevious)} />
          <Measure
            label={m.activeTenants.label}
            help={m.activeTenants.help}
            value={formatInteger(f.activeTenants)}
            context={formatTenantsComparison(f.activeTenants, f.activeTenantsPrevious)}
          />
          <Measure label={m.reach.label} help={m.reach.help} value={formatReach(f.reach)} />
          <Measure
            label={m.trend.label}
            help={trend.type === 'noBase' ? S.comparison.noBaseHint : m.trend.help}
            value={formatTrend(trend)}
            contextColor={toneColor[trendTone(trend)]}
          />
          <Measure
            label={m.lastUsed.label}
            help={m.lastUsed.help}
            value={f.lastUsedDay ? formatDay(f.lastUsedDay, true) : m.never}
            context={featureDataSince(f)}
          />
        </Box>
        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
          {f.kinds.map((k) => <Chip key={k} size="small" variant="outlined" label={kindLabel(k)} />)}
          <Typography variant="caption" color="text.secondary">{S.planFamilies[f.planFamily]}</Typography>
        </Stack>
      </SectionCard>

      {partial.length > 0 && (
        <Alert severity="info" aria-label={S.coverage.partialAria(label)}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{S.coverage.title}</Typography>
          {partial.map((text) => <Typography key={text} variant="body2">{text}</Typography>)}
        </Alert>
      )}

      <SectionCard
        title={S.detail.seriesTitle}
        subtitle={S.trend.subtitleFeature(label)}
        action={(
          <Button
            size="small"
            onClick={() => setView(asTable ? 'chart' : 'table')}
            startIcon={<AppIcon icon={asTable ? ChartLine : Table2} size="sm" aria-hidden />}
            sx={{ minHeight: 44 }}
          >
            {asTable ? S.actions.showChart : S.actions.showTable}
          </Button>
        )}
      >
        {noSeries ? (
          <Typography variant="body2" color="text.secondary">{S.trend.empty}</Typography>
        ) : (
          <Box sx={{ position: 'relative' }}>
            {!asTable && <SeriesChart detail={detail} tableId={tableId} />}
            <SeriesTable detail={detail} id={tableId} hidden={!asTable} />
          </Box>
        )}
      </SectionCard>

      {f.byKind.length > 1 && (
        <SectionCard title={S.detail.byKindTitle} noPadding>
          <TableContainer>
            <Table size="small" aria-label={S.detail.byKindTitle}>
              <TableHead>
                <TableRow>
                  <TableCell>{m.kinds.label}</TableCell>
                  <TableCell align="right">{m.uses.label}</TableCell>
                  <TableCell align="right">{m.activeTenants.label}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {f.byKind.map((b) => (
                  <TableRow key={b.kind}>
                    <TableCell>{kindLabel(b.kind)}</TableCell>
                    <TableCell align="right" sx={numCell}>{formatInteger(b.uses)}</TableCell>
                    <TableCell align="right" sx={numCell}>{formatInteger(b.activeTenants)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </SectionCard>
      )}

      <SectionCard title={S.detail.byPlanTitle} subtitle={S.planFamilies[f.planFamily]} noPadding>
        <TableContainer>
          <Table size="small" aria-label={S.detail.byPlanTitle}>
            <TableHead>
              <TableRow>
                <TableCell>{S.tenants.columns.plan}</TableCell>
                <TableCell align="right">{m.activeTenants.label}</TableCell>
                <TableCell align="right">{m.uses.label}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {f.byPlan.map((p) => (
                <TableRow key={p.plan}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{planLabel(p.plan)}</TableCell>
                  <TableCell align="right" sx={numCell}>
                    {p.tenants > 0 ? S.plansTab.cell(formatInteger(p.activeTenants), formatInteger(p.tenants)) : S.plansTab.noTenants}
                  </TableCell>
                  <TableCell align="right" sx={numCell}>{formatInteger(p.uses)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>
    </Stack>
  );
}
