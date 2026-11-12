import { useMemo } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { PLAN_CATALOG } from '@/features/plans/catalog';
import { toDomainPlanSlug } from '@/features/plans/planSlug';
import { chartColors } from '@/features/opsMetrics/chartColors';
import { planName } from '@/features/planEntitlementsAdmin/strings';
import { formatUsd, formatUsdCompact, historyChronological, historyPlanKeys, historyPlanTotal, monthLabel, shortMonthLabel } from '../rules';
import { infraCostsStrings as S } from '../strings';
import type { InfraCostHistoryMonthView } from '../types';

/** Slugs do domínio na ordem do catálogo (índice = cor). */
const CATALOG_KEYS = PLAN_CATALOG.map((p) => toDomainPlanSlug(p.slug));

/**
 * Barras empilhadas do total mensal (USD) por plano. Chunk próprio (`lazy`): a tabela não espera o x-charts.
 * Os três planos usam as cores de `chartColors` na ordem fixa do catálogo; "sem plano"/desconhecidos dobram no
 * neutro `chartColors().other` (o "Outros" da regra de dataviz), nunca uma 4ª cor categórica.
 *
 * Só visual: o svg fica fora do Tab e da árvore de acessibilidade (nada a fazer nele pelo teclado); a figura
 * aponta, por `aria-describedby`, a tabela da mesma aba (`tableId`), que tem os mesmos números.
 */
export default function HistoryChart({ months, tableId }: { months: InfraCostHistoryMonthView[]; tableId: string }) {
  const theme = useTheme();
  const small = useMediaQuery(theme.breakpoints.down('sm'));
  const mode = theme.palette.mode;
  const chart = useMemo(() => {
    const ordered = historyChronological(months);
    const keys = historyPlanKeys(ordered);
    const colors = chartColors(mode);
    const palette = colors.ordered;
    const series = keys.map((key) => {
      // Cor pelo plano (entidade), nunca pela posição na lista: o índice no catálogo; fora dele, o neutro.
      const index = key === null ? -1 : CATALOG_KEYS.indexOf(key);
      const color = index >= 0 && index < palette.length ? palette[index] : colors.other;
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
    <Box
      component="figure"
      aria-label={S.history.chartAria(monthLabel(first), monthLabel(last))}
      aria-describedby={tableId}
      sx={{ m: 0, minWidth: 0 }}
    >
      <BarChart
        aria-hidden
        focusable="false"
        tabIndex={-1}
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
        // Eixo em US$ compacto ("US$ 1,2 mil"): o valor cheio fica no tooltip e na tabela.
        yAxis={[{ width: 84, min: 0, valueFormatter: (v: number) => formatUsdCompact(v) }]}
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
