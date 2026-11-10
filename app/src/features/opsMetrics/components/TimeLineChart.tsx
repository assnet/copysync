import { useMemo } from 'react';
import { alpha, useMediaQuery, useTheme } from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';
import { useDrawingArea, useYScale } from '@mui/x-charts/hooks';
import type { LineSeriesType } from '@mui/x-charts/models';
import { BAND_OPACITY } from '../chartColors';
import { serverNow } from '@/services/serverClock';
import { OPS_RANGE_MS, formatDateTime, formatNumber, formatTick } from '../rules';
import { opsMetricsStrings as t } from '../strings';
import type { OpsRange } from '../types';

export interface LineSpec {
  id: string;
  label: string;
  color: string;
  values: (number | null)[];
  /** Banda mín–máx desenhada como área da mesma cor (sem borda). */
  band?: { min: (number | null)[]; max: (number | null)[] };
  /** Área empilhada (`stack: 'total'`). */
  stacked?: boolean;
  format: (v: number) => string;
}

/** Linha só de tooltip (sem traço nem legenda), ex.: total, MB, "mais antiga há". */
export interface TooltipExtra {
  id: string;
  label: string;
  text: (index: number) => string | null;
}

interface Props {
  times: number[];
  range: OpsRange;
  lines: LineSpec[];
  extras?: TooltipExtra[];
  yMin?: number;
  yMax?: number;
  reference?: { y: number; label: string };
}

const END_LABEL_GAP = 14;
/** Padrão estável: `[]` novo a cada render invalidaria o `useMemo` das séries. */
const NO_EXTRAS: TooltipExtra[] = [];

/** Rótulo só no tooltip: `undefined` na legenda tira a série dela (o tipo da lib não prevê). */
export function tooltipOnlyLabel(label: string) {
  return ((loc: 'legend' | 'tooltip') => (loc === 'tooltip' ? label : undefined)) as (loc: 'legend' | 'tooltip') => string;
}

/** Rótulo direto no fim de cada linha (identidade não depende só da cor). */
function EndLabels({ items }: { items: { label: string; color: string; value: number }[] }) {
  const theme = useTheme();
  const yScale = useYScale<'linear'>();
  const area = useDrawingArea();
  const x = area.left + area.width + 6;
  const placed = items
    .map((it) => ({ ...it, y: yScale(it.value) ?? 0 }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < placed.length; i += 1) {
    if (placed[i].y - placed[i - 1].y < END_LABEL_GAP) placed[i].y = placed[i - 1].y + END_LABEL_GAP;
  }
  return (
    <g aria-hidden>
      {placed.map((p) => (
        <g key={p.label}>
          <line x1={x} x2={x + 8} y1={p.y} y2={p.y} stroke={p.color} strokeWidth={2} />
          <text x={x + 12} y={p.y} dominantBaseline="middle" fontSize={11} fill={theme.palette.text.secondary}>
            {p.label}
          </text>
        </g>
      ))}
    </g>
  );
}

function lastIndex(values: (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i -= 1) if (values[i] != null) return i;
  return -1;
}

/**
 * Gráfico de linha no tempo da aba Consumo: média em 2 px, banda mín–máx opcional, ponto no
 * último valor, limiar neutro tracejado, tooltip por eixo e legenda/rótulo direto com ≥ 2 séries.
 */
export function TimeLineChart({ times, range, lines, extras = NO_EXTRAS, yMin, yMax, reference }: Props) {
  const theme = useTheme();
  const small = useMediaQuery(theme.breakpoints.down('md'));
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));
  const mode = theme.palette.mode;
  const multi = lines.length >= 2;
  // No celular a legenda do topo já nomeia as séries; o rótulo direto espremeria o plot.
  const directLabels = multi && lines.length <= 4 && !narrow;
  const labelRoom = directLabels ? Math.min(140, 26 + Math.max(...lines.map((l) => l.label.length)) * 6) : 24; // 24: meio rótulo do último tick (eixo strict)

  const series = useMemo(() => {
    const out: LineSeriesType[] = [];
    const noTooltip = () => null;
    for (const l of lines) {
      if (l.band) {
        const { min, max } = l.band;
        out.push({
          type: 'line', id: `${l.id}-bandbase`, data: min, stack: `${l.id}-band`, color: l.color,
          showMark: false, connectNulls: false, valueFormatter: noTooltip,
        });
        out.push({
          type: 'line', id: `${l.id}-band`, data: max.map((v, i) => (v == null || min[i] == null ? null : v - (min[i] as number))),
          stack: `${l.id}-band`, area: true, color: alpha(l.color, BAND_OPACITY[mode]),
          showMark: false, connectNulls: false, valueFormatter: noTooltip,
        });
      }
      const last = lastIndex(l.values);
      out.push({
        type: 'line', id: l.id, data: l.values, label: multi ? l.label : tooltipOnlyLabel(l.label),
        color: l.color, connectNulls: false, curve: 'linear',
        ...(l.stacked ? { stack: 'total', area: true } : {}),
        showMark: ({ index }) => index === last,
        valueFormatter: (v, { dataIndex }) => {
          if (v == null) return null;
          if (l.band) {
            const mn = l.band.min[dataIndex];
            const mx = l.band.max[dataIndex];
            if (mn != null && mx != null) return t.charts.bandTooltip(l.format(v), l.format(mn), l.format(mx));
          }
          return l.format(v);
        },
      });
    }
    for (const e of extras) {
      out.push({
        type: 'line', id: e.id, data: times.map(() => null), label: tooltipOnlyLabel(e.label),
        color: theme.palette.text.secondary, showMark: false,
        valueFormatter: (_v, { dataIndex }) => e.text(dataIndex),
      });
    }
    return out;
  }, [lines, extras, times, mode, multi, theme.palette.text.secondary]);

  const endItems = useMemo(() => {
    if (!directLabels) return [];
    let cumulative = 0;
    return lines.flatMap((l) => {
      const i = lastIndex(l.values);
      if (i < 0) return [];
      const v = l.values[i] as number;
      if (l.stacked) {
        const mid = cumulative + v / 2;
        cumulative += v;
        return [{ label: l.label, color: l.color, value: mid }];
      }
      return [{ label: l.label, color: l.color, value: v }];
    });
  }, [directLabels, lines]);

  // Eixo = período escolhido terminando agora: coleta parada aparece como trecho vazio no fim.
  const axisEnd = Math.max(serverNow(), times[times.length - 1] ?? 0);
  const axisStart = Math.min(axisEnd - OPS_RANGE_MS[range], times[0] ?? axisEnd);

  const hidden = lines.filter((l) => l.band).flatMap((l) => [`${l.id}-band`, `${l.id}-bandbase`]);
  // Traço da banda e ponto de destaque no hover das séries auxiliares (banda e linhas só de tooltip).
  const hideSelectors = [
    ...hidden.map((id) => `& path[data-series="${id}"][fill="none"]`),
    ...[...hidden, ...extras.map((e) => e.id)].map((id) => `& .MuiHighlightElement-series-${id}`),
  ].join(', ');

  return (
    <LineChart
      height={small ? 180 : 220}
      skipAnimation
      series={series}
      xAxis={[{
        data: times.map((ms) => new Date(ms)),
        scaleType: 'time',
        // Sem `nice`: o eixo não estica além do período (sem rótulo cortado no fim).
        domainLimit: 'strict',
        min: new Date(axisStart),
        max: new Date(axisEnd),
        valueFormatter: (d: Date, ctx) => (ctx.location === 'tick' ? formatTick(d.getTime(), range) : formatDateTime(d.getTime())),
      }]}
      yAxis={[{ min: yMin, max: yMax, width: 44, valueFormatter: (v: number) => formatNumber(v, 1) }]}
      grid={{ horizontal: true }}
      hideLegend={!multi}
      slotProps={{ legend: { position: { vertical: 'top', horizontal: 'start' } }, tooltip: { trigger: 'axis' } }}
      // top ≥ 16: abaixo disso a lib esconde o rótulo do topo do eixo Y (ex.: 100).
      margin={{ top: 16, right: labelRoom, bottom: 0, left: 0 }}
      sx={{
        '& .MuiChartsGrid-line': { stroke: theme.palette.divider },
        '& path[fill]:not([fill="none"])[data-series]': { stroke: theme.palette.background.paper, strokeWidth: lines.some((l) => l.stacked) ? 2 : 0 },
        ...(hideSelectors ? { [hideSelectors]: { display: 'none' } } : {}),
        '& .MuiMarkElement-root': { r: 4 },
      }}
    >
      {reference && (
        <ChartsReferenceLine
          y={reference.y}
          label={reference.label}
          labelAlign="end"
          lineStyle={{ stroke: theme.palette.text.secondary, strokeDasharray: '4 4', strokeWidth: 1 }}
          labelStyle={{ fontSize: 12, fill: theme.palette.text.secondary }}
        />
      )}
      {endItems.length > 0 && <EndLabels items={endItems} />}
    </LineChart>
  );
}
