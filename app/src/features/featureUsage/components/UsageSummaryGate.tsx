import type { ReactNode } from 'react';
import { Alert, Button, Skeleton, Stack, Typography } from '@mui/material';
import { ChartColumn } from 'lucide-react';
import { AppIcon, EmptyState, ServiceUpdatingState } from '@/components';
import { contextLine, earliestFirstDataDay, visibleFeatures } from '../rules';
import { featureUsageStrings as S } from '../strings';
import type { UsageFeatureItem, UsageFilters, UsageSummary } from '../types';
import { useUsagePage } from '../hooks/useUsagePage';
import { UsageKpiRowSkeleton } from './UsageKpiRow';

/** "Dias no horário de Brasília · dados desde 26/10/2026 · atualizado às 15:02" (menor `firstDataDay` visível). */
export function UsageContextLine({ features, freshAt }: { features: readonly Pick<UsageFeatureItem, 'firstDataDay'>[]; freshAt: string }) {
  return (
    <Typography variant="caption" color="text.secondary" component="p" aria-label={S.context.aria}>
      {contextLine({ firstDataDay: earliestFirstDataDay(features), freshAt })}
    </Typography>
  );
}

/** Erro e leitura lenta: `Alert` com "Tentar de novo" (o 503 `USAGE_METRICS_READ_UNAVAILABLE` tem texto próprio). */
export function UsageRetryAlert({ slow, onRetry, message }: { slow: boolean; onRetry: () => void; message?: string }) {
  return (
    <Alert
      severity={slow ? 'warning' : 'error'}
      action={<Button color="inherit" size="small" sx={{ whiteSpace: 'nowrap' }} onClick={onRetry}>{S.actions.retry}</Button>}
    >
      {slow ? S.errors.readSlow : message ?? S.errors.loadFailed}
    </Alert>
  );
}

/** Recursos do resumo que valem para os filtros da tela (defesa: a API já recorta). */
export function summaryFeatures(summary: UsageSummary, filters: UsageFilters): UsageFeatureItem[] {
  return visibleFeatures(summary.features, filters);
}

/**
 * Estados comuns das abas que leem o resumo: serviço atualizando, erro/leitura lenta, carregando (esqueleto no
 * formato dos blocos), vazio (com "Limpar filtros") e, com dado, linha de contexto + `children(resumo)`.
 */
export function UsageSummaryGate({
  children,
  onClearFilters,
}: {
  children: (summary: UsageSummary) => ReactNode;
  onClearFilters: () => void;
}) {
  const { summary: q, filters } = useUsagePage();
  const { data } = q;

  if (q.unavailable && !data) return <ServiceUpdatingState onRetry={q.reload} />;
  if ((q.error || q.slow) && !data && !q.loading) return <UsageRetryAlert slow={q.slow} onRetry={q.reload} />;
  if (!data) {
    return (
      <Stack spacing={2} role="status" aria-label={S.states.loading}>
        <Skeleton variant="text" width={320} />
        <UsageKpiRowSkeleton />
        <Skeleton variant="rounded" height={320} />
      </Stack>
    );
  }

  const features = summaryFeatures(data, filters);
  const empty = features.length === 0 || data.totals.activeTenants === 0;
  return (
    <Stack spacing={2} aria-busy={q.loading}>
      <UsageContextLine features={features} freshAt={data.freshAt} />
      {empty ? (
        <EmptyState
          icon={<AppIcon icon={ChartColumn} size="lg" aria-hidden />}
          title={S.states.emptyTitle}
          description={S.states.emptyDescription}
          action={<Button variant="outlined" onClick={onClearFilters}>{S.actions.clearFilters}</Button>}
        />
      ) : children(data)}
    </Stack>
  );
}
