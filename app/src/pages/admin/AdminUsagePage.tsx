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
  DEFAULT_USAGE_FILTERS, parseUsageFilters, presetDays, toUsageQuery, toUsageSummaryQuery, USAGE_FILTERS_KEY, USAGE_FILTERS_VERSION, USAGE_MAX_DAYS, withPeriod,
} from '@/features/featureUsage/rules';
import type { UsageFilters } from '@/features/featureUsage/types';
import { useUsageSummary } from '@/features/featureUsage/hooks/useUsageSummary';
import { useLoadedAccountNames } from '@/features/featureUsage/hooks/useLoadedAccountNames';
import {
  parseScreensView, UsagePageContext, type ScreensView, type UsagePageValue,
} from '@/features/featureUsage/hooks/useUsagePage';
import { UsageFiltersBar } from '@/features/featureUsage/components/UsageFiltersBar';
import { knownUsageMaxDays, rememberUsageMaxDays } from '@/features/featureUsage/usageMaxDays';
import { ExportSummaryButton } from '@/features/featureUsage/components/ExportSummaryButton';

/** Cada aba em chunk próprio (gráficos e tabelas carregam à parte). */
const OverviewTab = lazy(() => import('@/features/featureUsage/components/OverviewTab'));
const PlansTab = lazy(() => import('@/features/featureUsage/components/PlansTab'));
const FeatureDetailTab = lazy(() => import('@/features/featureUsage/components/FeatureDetailTab'));
const ScreensTab = lazy(() => import('@/features/featureUsage/components/ScreensTab'));

const TAB_LABELS = { overview: S.tabs.overview, plans: S.tabs.plans, screens: S.tabs.screens } as const;

/**
 * Uso dos recursos (super admin): cabeçalho, abas por sub-rota, filtros persistidos (`usage.filters`, escopo `tab`) e
 * o resumo compartilhado com as abas por contexto. No detalhe o resumo não é lido; toda leitura passa pela fila de `adminUsage.service` (uma por vez por aba).
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
    // Releitura contra o teto ABSOLUTO (400): o teto da última resposta some no reload e derrubaria um período longo
    // válido. Quem decide é a API: período recusado (400) volta ao padrão com o aviso de `rangeReset`.
    deserialize: (raw) => parseUsageFilters(raw, serverNow(), USAGE_MAX_DAYS),
  });
  const [screensView, setScreensView] = usePersistedState<ScreensView>('usage.screensView', 'chart', {
    scope: 'tab', version: 1, deserialize: parseScreensView,
  });
  const onScreens = featureKey === null && activeTab === 'screens';
  const [maxDays, setMaxDaysState] = useState(knownUsageMaxDays);
  /** Teto informado por qualquer resposta: vale na tela e na próxima releitura dos filtros salvos. */
  const setMaxDays = useCallback((n: number) => {
    rememberUsageMaxDays(n);
    setMaxDaysState(n);
  }, []);
  const [refreshKey, setRefreshKey] = useState(0);
  /** Período recusado pela API (400): aviso até a próxima troca de filtro; `max` = `meta.maxDays` ou `null`. */
  const [rangeReset, setRangeReset] = useState<{ max: number | null } | null>(null);
  const accountNames = useLoadedAccountNames();
  /** Teto da barra: o em vigor, sem esconder o período salvo mais longo (a API confirma ou recusa). */
  const currentDays = presetDays(filters.preset, filters.from, filters.to) ?? 0;
  // A aba Telas tem teto próprio (400, o da rota de telas) e não herda o do resumo.
  const barMaxDays = onScreens ? USAGE_MAX_DAYS : Math.min(USAGE_MAX_DAYS, Math.max(maxDays, currentDays));

  // "Hoje" dos presets vem do relógio do servidor; muda o dia, muda a query.
  const query = toUsageQuery(filters, serverNow());
  // Só o resumo leva o N da recorrência; detalhe, contas e telas usam a query comum.
  const summaryQuery = toUsageSummaryQuery(filters, serverNow());

  const changeFilters = useCallback((next: UsageFilters) => {
    setRangeReset(null);
    setFilters(next);
  }, [setFilters]);

  // Na aba Telas o resumo só é lido com a tabela alternativa aberta (fila: um pedido por vez), para o cruzamento
  // "abriu × usou". Lá o período recusado pelo resumo não reseta os filtros: a coluna cruzada mostra a falha.
  const summary = useUsageSummary(summaryQuery, {
    enabled: featureKey === null && (!onScreens || screensView === 'table'),
    refreshKey,
    onRangeInvalid: (max) => {
      if (onScreens) return false;
      if (max !== null) setMaxDays(max);
      setRangeReset({ max });
      setFilters(withPeriod(filters, { preset: DEFAULT_USAGE_FILTERS.preset }, serverNow()));
    },
  });

  // O teto em vigor vem da resposta (`range.maxDays`); antes dela vale o do painel.
  const reportedMax = summary.data?.range.maxDays;
  useEffect(() => {
    if (reportedMax !== undefined) setMaxDays(reportedMax);
  }, [reportedMax, setMaxDays]);

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
    screensView,
    setScreensView,
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
              {featureKey === null && activeTab !== 'screens' && (
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
            maxDays={barMaxDays}
            accountName={accountNames.nameOf(filters.tenantId)}
            showRecurring={featureKey === null && activeTab !== 'screens'}
          />
          {rangeReset !== null && (
            <Alert severity="info">{rangeReset.max !== null ? S.rangeReset(rangeReset.max) : S.rangeResetNeutral}</Alert>
          )}

          <Suspense fallback={loading}>
            {featureKey !== null ? <FeatureDetailTab key={featureKey} />
              : activeTab === 'plans' ? <PlansTab />
                : activeTab === 'screens' ? <ScreensTab /> : <OverviewTab />}
          </Suspense>
        </Stack>
      </Box>
    </UsagePageContext.Provider>
  );
}
