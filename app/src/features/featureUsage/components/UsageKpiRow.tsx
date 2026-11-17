import type { ReactNode } from 'react';
import { Box, Card, CardContent, Skeleton, Stack, Typography } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import { Boxes, Trophy, Users } from 'lucide-react';
import { AppIcon } from '@/components';
import { HelpTip } from '@/features/opsMetrics/components/HelpTip';
import {
  featureLabel, featuresTotal, formatCount, formatInteger, formatTenantsComparison, topFeatureOf,
} from '../rules';
import { featureUsageStrings as S } from '../strings';
import type { UsageSummary } from '../types';

const k = S.kpis;

interface KpiProps {
  label: string;
  help: string;
  icon: LucideIcon;
  value: ReactNode;
  context?: string;
}

/** Indicador com rótulo, definição no `Tooltip` e uma linha de contexto (comparação ou detalhe). */
function Kpi({ label, help, icon, value, context }: KpiProps) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', color: 'text.secondary' }}>
          <AppIcon icon={icon} size="inline" aria-hidden />
          <Typography variant="body2" component="h3" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{label}</Typography>
          <HelpTip label={label} text={help} />
        </Stack>
        <Typography
          variant="h5"
          component="p"
          sx={{ mt: 1, fontWeight: 700, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}
        >
          {value}
        </Typography>
        {context && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>{context}</Typography>
        )}
      </CardContent>
    </Card>
  );
}

const grid = {
  display: 'grid',
  gap: 2,
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' },
} as const;

/** Esqueleto no formato dos três indicadores. */
export function UsageKpiRowSkeleton() {
  return (
    <Box sx={grid} role="status" aria-label={S.states.loading}>
      {[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={112} />)}
    </Box>
  );
}

/** Três indicadores: contas ativas, recursos usados ("x de N") e o mais usado. Não há soma de usos entre recursos. */
export function UsageKpiRow({ summary }: { summary: UsageSummary }) {
  const { totals, population } = summary;
  const top = topFeatureOf(summary);
  return (
    <Box sx={grid} role="group" aria-label={k.aria}>
      <Kpi
        label={k.activeTenants.label}
        help={k.activeTenants.help}
        icon={Users}
        value={k.activeTenants.value(formatInteger(totals.activeTenants), formatInteger(population.tenants))}
        context={formatTenantsComparison(totals.activeTenants, totals.activeTenantsPrevious)}
      />
      <Kpi
        label={k.featuresUsed.label}
        help={k.featuresUsed.help}
        icon={Boxes}
        value={k.featuresUsed.value(formatInteger(totals.featuresUsed), formatInteger(featuresTotal(totals)))}
        context={k.featuresUsed.neverUsed(totals.featuresNeverUsed)}
      />
      <Kpi
        label={k.topFeature.label}
        help={k.topFeature.help}
        icon={Trophy}
        value={top ? featureLabel(top.key) : k.topFeature.none}
        context={top ? k.topFeature.context(formatCount(top.activeTenants)) : undefined}
      />
    </Box>
  );
}
