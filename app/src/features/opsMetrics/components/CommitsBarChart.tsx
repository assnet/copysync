import { useMediaQuery, useTheme } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { formatDateTime, formatNumber, formatTick } from '../rules';
import type { OpsRange } from '../types';
import { tooltipOnlyLabel } from './TimeLineChart';

interface Props {
  times: number[];
  values: (number | null)[];
  range: OpsRange;
  label: string;
  color: string;
}

const MIN = 60_000;
const NICE_STEPS = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map((m) => m * MIN);

/** Hora local em ms (rótulos caem em hora cheia no fuso de quem vê). */
function localMs(ms: number) {
  return ms - new Date(ms).getTimezoneOffset() * MIN;
}

/** Passo "redondo" (5 min … 1 dia) que dá no máximo `maxTicks` rótulos no período. */
export function barTickStep(times: number[], maxTicks: number) {
  const span = times.length > 1 ? times[times.length - 1] - times[0] : 0;
  return NICE_STEPS.find((s) => span / s <= maxTicks) ?? NICE_STEPS[NICE_STEPS.length - 1];
}

/** Barras por balde (taxa por minuto); balde de reinício fica vazio. */
export function CommitsBarChart({ times, values, range, label, color }: Props) {
  const theme = useTheme();
  const small = useMediaQuery(theme.breakpoints.down('md'));
  const tickMs = barTickStep(times, small ? 4 : 6);
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
        tickInterval: (v: Date) => localMs(v.getTime()) % tickMs === 0,
        valueFormatter: (d: Date, ctx) => (ctx.location === 'tick' ? formatTick(d.getTime(), range) : formatDateTime(d.getTime())),
      }]}
      yAxis={[{ width: 44, min: 0, valueFormatter: (v: number) => formatNumber(v) }]}
      grid={{ horizontal: true }}
      margin={{ top: 16, right: 12, bottom: 0, left: 0 }}
      sx={{ '& .MuiChartsGrid-line': { stroke: theme.palette.divider } }}
    />
  );
}
