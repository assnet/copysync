import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, MenuItem, Skeleton, Stack, TextField } from '@mui/material';
import { usePersistedState } from '@/hooks/usePersistedState';
import { adminUsageService } from '@/services/adminUsage.service';
import { USAGE_ERROR_CODES, clearUsageFilters, featureLabel, usageErrorCode, isUsageReadSuperseded } from '../rules';
import { featureUsageStrings as S } from '../strings';
import type { UsageFeatureDetail, UsageFeatureItem, UsageQuery, UsageSort, UsageSummary } from '../types';
import { useUsagePage } from '../hooks/useUsagePage';
import { UsageKpiRow } from './UsageKpiRow';
import { UsageSummaryGate, summaryFeatures } from './UsageSummaryGate';
import { NeverUsedList } from './NeverUsedList';
import type { UsageTrendData } from './UsageTrendChart';

// Gráficos em chunk próprio: os indicadores e a lista não esperam o x-charts.
const FeatureRankingChart = lazy(() => import('./FeatureRankingChart'));
const UsageTrendChart = lazy(() => import('./UsageTrendChart'));

const OVERALL = '__overall';
const TREND_FEATURE_KEY = 'usage.trendFeature';
const parseTrendFeature = (raw: unknown): string | null => (typeof raw === 'string' && raw ? raw : null);

const chartFallback = <Skeleton variant="rounded" sx={{ height: { xs: 280, md: 360 } }} aria-label={S.states.loading} />;

/**
 * Série de um recurso para a tendência (`GET /admin/usage/features/:key`, só a série é usada aqui). Só lê depois que
 * o resumo do recorte atual concluiu (`enabled = summary.ready`) e pelo canal `trend` da fila do serviço (uma leitura
 * por vez por aba; troca rápida de recurso descarta o pedido ainda na fila). Resposta de pedido antigo é descartada.
 */
function useTrendFeatureDetail(featureKey: string | null, query: UsageQuery, enabled: boolean, refreshKey: number) {
  const queryKey = JSON.stringify(query);
  const [result, setResult] = useState<{ id: string; data: UsageFeatureDetail } | null>(null);
  const [error, setError] = useState(false);
  const [slow, setSlow] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  const id = `${featureKey}|${queryKey}|${refreshKey}`;

  useEffect(() => {
    const current = ++request.current;
    setError(false);
    setSlow(false);
    if (!featureKey || !enabled) return;
    adminUsageService.getDetail(featureKey, JSON.parse(queryKey) as UsageQuery, 'trend')
      .then((data) => { if (current === request.current) setResult({ id, data }); })
      .catch((err: unknown) => {
        if (current !== request.current || isUsageReadSuperseded(err)) return;
        const isSlow = usageErrorCode(err) === USAGE_ERROR_CODES.readUnavailable;
        setSlow(isSlow);
        setError(!isSlow);
      });
  }, [featureKey, queryKey, enabled, id, retry]);

  const reload = useCallback(() => setRetry((n) => n + 1), []);
  return { data: result?.id === id ? result.data : null, error, slow, reload };
}

function OverviewContent({ summary }: { summary: UsageSummary }) {
  const { filters, setFilters, query, summary: summaryState, refreshKey, reportMaxDays } = useUsagePage();
  const features = useMemo(() => summaryFeatures(summary, filters), [summary, filters]);
  const [trendKey, setTrendKey] = usePersistedState<string | null>(TREND_FEATURE_KEY, null, {
    scope: 'tab', version: 1, deserialize: parseTrendFeature,
  });
  // Recurso salvo que saiu do recorte volta para o geral (sem apagar a escolha).
  const trendFeature: UsageFeatureItem | null = features.find((f) => f.key === trendKey) ?? null;
  const detail = useTrendFeatureDetail(trendFeature?.key ?? null, query, summaryState.ready, refreshKey);
  useEffect(() => { if (detail.data) reportMaxDays(detail.data.range.maxDays); }, [detail.data, reportMaxDays]);

  const options = useMemo(
    () => [...features].sort((a, b) => featureLabel(a.key).localeCompare(featureLabel(b.key), 'pt-BR')),
    [features],
  );

  const trendData: UsageTrendData | null = trendFeature
    ? (detail.data ? { type: 'feature', feature: trendFeature, series: detail.data.series } : null)
    : { type: 'overall', series: summary.series };

  const control = (
    <TextField
      select
      size="small"
      label={S.trend.featureSelect}
      value={trendFeature?.key ?? OVERALL}
      onChange={(e) => setTrendKey(e.target.value === OVERALL ? null : e.target.value)}
      sx={{ maxWidth: { sm: 320 } }}
      fullWidth
    >
      <MenuItem value={OVERALL}>{S.trend.overallOption}</MenuItem>
      {options.map((f) => <MenuItem key={f.key} value={f.key}>{featureLabel(f.key)}</MenuItem>)}
    </TextField>
  );

  return (
    <Stack spacing={2}>
      <UsageKpiRow summary={summary} />
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 7fr) minmax(0, 5fr)' },
          alignItems: 'stretch',
        }}
      >
        <Suspense fallback={chartFallback}>
          <FeatureRankingChart
            features={features}
            sort={filters.sort}
            onSortChange={(sort: UsageSort) => setFilters({ ...filters, sort })}
          />
        </Suspense>
        <Suspense fallback={chartFallback}>
          <UsageTrendChart
            granularity={summary.range.granularity}
            data={trendData}
            error={!!trendFeature && detail.error}
            slow={!!trendFeature && detail.slow}
            onRetry={detail.reload}
            control={control}
          />
        </Suspense>
      </Box>
      <NeverUsedList features={features} />
    </Stack>
  );
}

/**
 * Aba Visão geral (`/admin/usage`): indicadores, ranking dos recursos, tendência e recursos sem uso no período.
 */
export default function OverviewTab() {
  const { filters, setFilters } = useUsagePage();
  return (
    <UsageSummaryGate onClearFilters={() => setFilters(clearUsageFilters(filters))}>
      {(summary) => <OverviewContent summary={summary} />}
    </UsageSummaryGate>
  );
}
