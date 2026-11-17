import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Alert, Box, IconButton, Skeleton, Stack, Tab, Tabs, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import { RefreshCw } from 'lucide-react';
import { AppIcon, PageHeader } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { serverNow } from '@/services/serverClock';
import { featureUsageStrings as S } from '@/features/featureUsage/strings';
import { activeUsageTab, featureKeyFromPath, USAGE_TABS } from '@/features/featureUsage/paths';
import {
  DEFAULT_USAGE_FILTERS, parseUsageFilters, toUsageQuery, USAGE_FILTERS_KEY, USAGE_FILTERS_VERSION, USAGE_MAX_DAYS,
  withPeriod,
} from '@/features/featureUsage/rules';
import type { UsageFilters } from '@/features/featureUsage/types';
import { useUsageSummary } from '@/features/featureUsage/hooks/useUsageSummary';
import { useLoadedAccountNames } from '@/features/featureUsage/hooks/useLoadedAccountNames';
import { UsagePageContext, type UsagePageValue } from '@/features/featureUsage/hooks/useUsagePage';
import { UsageFiltersBar } from '@/features/featureUsage/components/UsageFiltersBar';
import { ExportSummaryButton } from '@/features/featureUsage/components/ExportSummaryButton';

/** Cada aba em chunk próprio (gráficos e tabelas carregam à parte). */
const OverviewTab = lazy(() => import('@/features/featureUsage/components/OverviewTab'));
const PlansTab = lazy(() => import('@/features/featureUsage/components/PlansTab'));
const FeatureDetailTab = lazy(() => import('@/features/featureUsage/components/FeatureDetailTab'));

const TAB_LABELS = { overview: S.tabs.overview, plans: S.tabs.plans } as const;

/**
 * Uso dos recursos (super admin): cabeçalho, abas por sub-rota, filtros persistidos (`usage.filters`, escopo `tab`) e
 * o resumo compartilhado com as abas por contexto. No detalhe o resumo não é lido (uma leitura de uso por vez).
 */
export function AdminUsagePage() {
  const { pathname } = useLocation();
  const activeTab = activeUsageTab(pathname);
  const featureKey = featureKeyFromPath(pathname);
  const theme = useTheme();
  const compactTabs = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });

  const [filters, setFilters] = usePersistedState<UsageFilters>(USAGE_FILTERS_KEY, DEFAULT_USAGE_FILTERS, {
    scope: 'tab',
    version: USAGE_FILTERS_VERSION,
    deserialize: (raw) => parseUsageFilters(raw, serverNow()),
  });
  const [maxDays, setMaxDays] = useState(USAGE_MAX_DAYS);
  const [refreshKey, setRefreshKey] = useState(0);
  /** Teto do período que a API recusou (400): aviso até a próxima troca de filtro. */
  const [rangeResetMax, setRangeResetMax] = useState<number | null>(null);
  const accountNames = useLoadedAccountNames();

  // "Hoje" dos presets vem do relógio do servidor; muda o dia, muda a query.
  const query = toUsageQuery(filters, serverNow());

  const changeFilters = useCallback((next: UsageFilters) => {
    setRangeResetMax(null);
    setFilters(next);
  }, [setFilters]);

  const summary = useUsageSummary(query, {
    enabled: featureKey === null,
    refreshKey,
    onRangeInvalid: () => {
      setRangeResetMax(maxDays);
      setFilters(withPeriod(filters, { preset: DEFAULT_USAGE_FILTERS.preset }, serverNow()));
    },
  });

  // O teto em vigor vem da resposta (`range.maxDays`); antes dela vale o do painel.
  const reportedMax = summary.data?.range.maxDays;
  useEffect(() => {
    if (reportedMax !== undefined) setMaxDays(reportedMax);
  }, [reportedMax]);

  // Sem memo: a página re-renderiza a cada filtro e as abas leem o valor novo de qualquer forma.
  const value: UsagePageValue = {
    filters,
    setFilters: changeFilters,
    query,
    maxDays,
    summary,
    refreshKey,
    reportMaxDays: setMaxDays,
    featureKey,
    accountNames,
  };

  const refresh = (
    <Tooltip title={S.actions.refreshAria}>
      <IconButton aria-label={S.actions.refreshAria} onClick={() => setRefreshKey((n) => n + 1)} sx={{ width: 44, height: 44 }}>
        <AppIcon icon={RefreshCw} size="md" />
      </IconButton>
    </Tooltip>
  );

  const loading = <Skeleton variant="rounded" height={320} role="status" aria-label={S.states.loading} />;

  return (
    <UsagePageContext.Provider value={value}>
      <Box sx={{ minWidth: 0 }}>
        <PageHeader
          title={S.pageTitle}
          subtitle={S.pageSubtitle}
          action={(
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {/* No detalhe o resumo não é lido: sem dado da tela para exportar. */}
              {featureKey === null && (
                <ExportSummaryButton summary={summary.data} loading={summary.loading} sort={filters.sort} />
              )}
              {refresh}
            </Stack>
          )}
          sx={{ mb: 2 }}
        />
        <Tabs
          value={activeTab}
          aria-label={S.tabs.aria}
          variant="scrollable"
          scrollButtons={compactTabs ? true : 'auto'}
          allowScrollButtonsMobile
          sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          {USAGE_TABS.map((tab) => (
            <Tab key={tab.id} label={TAB_LABELS[tab.id]} value={tab.id} component={Link} to={tab.path} />
          ))}
        </Tabs>

        <Stack spacing={2}>
          <UsageFiltersBar
            filters={filters}
            onChange={changeFilters}
            maxDays={maxDays}
            accountName={accountNames.nameOf(filters.tenantId)}
          />
          {rangeResetMax !== null && <Alert severity="info">{S.rangeReset(rangeResetMax)}</Alert>}

          <Suspense fallback={loading}>
            {featureKey !== null ? <FeatureDetailTab key={featureKey} />
              : activeTab === 'plans' ? <PlansTab /> : <OverviewTab />}
          </Suspense>
        </Stack>
      </Box>
    </UsagePageContext.Provider>
  );
}
