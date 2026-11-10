import { useMediaQuery, useTheme } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { formatDateTime, formatNumber, formatTick } from '../rules';
import type { OpsRange } from '../types';
import { tooltipOnlyLabel } from './TimeLineChart';
import { barTickSet, barTickStep } from './barTicks';

interface Props {
  times: number[];
  values: (number | null)[];
  range: OpsRange;
  label: string;
  color: string;
}

/** Barras por balde (taxa por minuto); balde de reinício fica vazio. */
export function CommitsBarChart({ times, values, range, label, color }: Props) {
  const theme = useTheme();
  const small = useMediaQuery(theme.breakpoints.down('md'));
  const tickMs = barTickStep(times, small ? 4 : 6);
  const ticks = barTickSet(times, tickMs);
  return (
    <BarChart
      height={small ? 180 : 220}
      skipAnimation
      borderRadius={4}
      hideLegend
      series={[{
        data: values,
        label: tooltipOnlyLabel(label),
        color,
        valueFormatter: (v) => (v == null ? null : formatNumber(v, 1)),
      }]}
      xAxis={[{
        data: times.map((ms) => new Date(ms)),
        scaleType: 'band',
        categoryGapRatio: 0.15,
        // Um filtro só: com dois, o índice do rótulo é relativo aos ticks já filtrados e sobra 1 rótulo.
        tickInterval: (v: Date) => ticks.has(v.getTime()),
        valueFormatter: (d: Date, ctx) => (ctx.location === 'tick' ? formatTick(d.getTime(), range) : formatDateTime(d.getTime())),
      }]}
      yAxis={[{ width: 44, min: 0, valueFormatter: (v: number) => formatNumber(v) }]}
      grid={{ horizontal: true }}
      margin={{ top: 16, right: 12, bottom: 0, left: 0 }}
      sx={{ '& .MuiChartsGrid-line': { stroke: theme.palette.divider } }}
    />
  );
}
