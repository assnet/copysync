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

/** Barras por balde (taxa por minuto); balde de reinício fica vazio. */
export function CommitsBarChart({ times, values, range, label, color }: Props) {
  const theme = useTheme();
  const small = useMediaQuery(theme.breakpoints.down('md'));
  const step = Math.max(1, Math.ceil(times.length / (small ? 4 : 6)));
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
        tickLabelInterval: (_v, i) => i % step === 0,
        tickInterval: (_v, i) => i % step === 0,
        valueFormatter: (d: Date, ctx) => (ctx.location === 'tick' ? formatTick(d.getTime(), range) : formatDateTime(d.getTime())),
      }]}
      yAxis={[{ width: 44, min: 0 }]}
      grid={{ horizontal: true }}
      margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
      sx={{ '& .MuiChartsGrid-line': { stroke: theme.palette.divider } }}
    />
  );
}
