import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import { SparkLineChart } from '@mui/x-charts/SparkLineChart';
import { AppIcon } from '@/components';
import { opsMetricsStrings as t } from '../strings';
import type { OpsStatus } from '../types';
import { HelpTip } from './HelpTip';
import { StatusChip } from './StatusChip';

export interface UsageKpiTileProps {
  label: string;
  icon: LucideIcon;
  value: string;
  context?: string;
  status: OpsStatus;
  help: string;
  spark: number[];
  sparkColor: string;
  formatValue: (v: number) => string;
}

/** Até 2 linhas: no tile estreito (celular, 4 por linha no desktop) o rótulo quebra em vez de virar "RAM · P…". */
const clamp2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as const;

/** KPI "agora": valor, contexto, status e tendência do período. */
export function UsageKpiTile({ label, icon, value, context, status, help, spark, sparkColor, formatValue }: UsageKpiTileProps) {
  const min = spark.length ? Math.min(...spark) : null;
  const max = spark.length ? Math.max(...spark) : null;
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'flex-start', color: 'text.secondary' }}>
          <AppIcon icon={icon} size="inline" aria-hidden />
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600, textTransform: 'uppercase', letterSpacing: { xs: 0.1, sm: 0.4 }, flex: 1, minWidth: 0,
              lineHeight: 1.3, minHeight: '2.6em', ...clamp2,
            }}
          >
            {label}
          </Typography>
          <Box sx={{ mt: -0.25, mr: -0.75 }}><HelpTip label={label} text={help} /></Box>
        </Stack>
        <Typography variant="h5" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', mt: 0.5 }}>
          {value}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ lineHeight: 1.3, minHeight: '2.6em', ...clamp2 }}>
          {context ?? ' '}
        </Typography>
        <Box sx={{ mt: 0.75 }}><StatusChip status={status} /></Box>
        <Box
          role="img"
          aria-label={min != null && max != null ? t.kpi.trendAria(label, formatValue(min), formatValue(max)) : t.charts.empty}
          sx={{ height: 32, mt: 1 }}
        >
          {spark.length > 1 && (
            <SparkLineChart
              data={spark}
              height={32}
              color={sparkColor}
              curve="linear"
              margin={{ top: 4, bottom: 4, left: 0, right: 0 }}
            />
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
