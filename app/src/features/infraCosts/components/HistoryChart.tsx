import { useMemo } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { PLAN_CATALOG } from '@/features/plans/catalog';
import { toDomainPlanSlug } from '@/features/plans/planSlug';
import { chartColors } from '@/features/opsMetrics/chartColors';
import { planName } from '@/features/planEntitlementsAdmin/strings';
import { formatUsd, historyChronological, historyPlanKeys, historyPlanTotal, monthLabel, shortMonthLabel } from '../rules';
import { infraCostsStrings as S } from '../strings';
import type { InfraCostHistoryMonthView } from '../types';

/**
 * "Sem plano"/desconhecidos dobram num cinza neutro (o "Outros" da regra de dataviz): nunca uma 4ª cor
 * categórica. Os três planos usam as cores já validadas de `chartColors`, na ordem fixa do catálogo.
 */
const OTHER_COLOR = { light: '#757575', dark: '#80858f' } as const;

/** Slugs do domínio na ordem do catálogo (índice = cor). */
const CATALOG_KEYS = PLAN_CATALOG.map((p) => toDomainPlanSlug(p.slug));

/** Barras empilhadas do total mensal (USD) por plano. Chunk próprio (`lazy`): a tabela não espera o x-charts. */
export default function HistoryChart({ months }: { months: InfraCostHistoryMonthView[] }) {
  const theme = useTheme();
  const small = useMediaQuery(theme.breakpoints.down('sm'));
  const mode = theme.palette.mode;
  const chart = useMemo(() => {
    const ordered = historyChronological(months);
    const keys = historyPlanKeys(ordered);
    const palette = chartColors(mode).ordered;
    const series = keys.map((key) => {
      // Cor pelo plano (entidade), nunca pela posição na lista: o índice no catálogo; fora dele, o neutro.
      const index = key === null ? -1 : CATALOG_KEYS.indexOf(key);
      const color = index >= 0 && index < palette.length ? palette[index] : OTHER_COLOR[mode];
      return {
        id: key ?? '__none',
        label: key ? planName(key) : S.summary.plans.noPlan,
        color,
        stack: 'total',
        data: ordered.map((m) => historyPlanTotal(m, key)?.usd ?? 0),
        valueFormatter: (v: number | null) => (v == null ? null : formatUsd(v)),
      };
    });
    return { ordered, series };
  }, [months, mode]);

  const first = chart.ordered[0]?.month ?? '';
  const last = chart.ordered[chart.ordered.length - 1]?.month ?? '';
  return (
    <Box component="figure" aria-label={S.history.chartAria(monthLabel(first), monthLabel(last))} sx={{ m: 0, minWidth: 0 }}>
      <BarChart
        height={small ? 220 : 280}
        skipAnimation
        borderRadius={4}
        series={chart.series}
        xAxis={[{
          data: chart.ordered.map((m) => m.month),
          scaleType: 'band',
          categoryGapRatio: 0.35,
          valueFormatter: (v: string, ctx) => (ctx.location === 'tick' ? shortMonthLabel(v) : monthLabel(v)),
        }]}
        yAxis={[{ width: 56, min: 0, valueFormatter: (v: number) => formatUsd(v) }]}
        grid={{ horizontal: true }}
        slotProps={{ legend: { position: { vertical: 'top', horizontal: 'start' } }, tooltip: { trigger: 'axis' } }}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        sx={{
          '& .MuiChartsGrid-line': { stroke: theme.palette.divider },
          // 2 px da superfície entre segmentos empilhados.
          '& .MuiBarElement-root': { stroke: theme.palette.background.paper, strokeWidth: 2 },
        }}
      />
    </Box>
  );
}
