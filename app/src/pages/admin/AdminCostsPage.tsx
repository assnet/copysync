import { lazy, Suspense } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Box, Skeleton, Tab, Tabs, useMediaQuery, useTheme } from '@mui/material';
import { PageHeader } from '@/components';
import { infraCostsStrings as t } from '@/features/infraCosts/strings';
import { COSTS_HISTORY_PATH, COSTS_PATH, COSTS_PRICES_PATH, COSTS_TENANTS_PATH } from '@/features/infraCosts/paths';

/** Aba Resumo em chunk próprio (cartões, tabelas por plano e por serviço). */
const SummaryTab = lazy(() => import('@/features/infraCosts/components/SummaryTab'));
/** Aba Preços em chunk próprio (formulário, diálogo do diff). */
const PricesTab = lazy(() => import('@/features/infraCosts/components/PricesTab'));
/** Aba Por cliente em chunk próprio (lista paginada no servidor). */
const TenantsTab = lazy(() => import('@/features/infraCosts/components/TenantsTab'));
/** Aba Histórico em chunk próprio; o gráfico ainda carrega à parte. */
const HistoryTab = lazy(() => import('@/features/infraCosts/components/HistoryTab'));

/** Abas pela URL: caminho → rótulo. A ativa é a de prefixo mais longo que casa com o caminho. */
export const COST_TABS: { path: string; label: string }[] = [
  { path: COSTS_PATH, label: t.tabs.summary },
  { path: COSTS_TENANTS_PATH, label: t.tabs.tenants },
  { path: COSTS_HISTORY_PATH, label: t.tabs.history },
  { path: COSTS_PRICES_PATH, label: t.tabs.prices },
];

export function activeCostsTab(pathname: string): string {
  const match = COST_TABS
    .filter((tab) => pathname === tab.path || pathname.startsWith(`${tab.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return match?.path ?? COSTS_PATH;
}

/** Custos da infraestrutura (super admin): abas por sub-rota, cada uma em chunk `lazy`. */
export function AdminCostsPage() {
  const { pathname } = useLocation();
  const active = activeCostsTab(pathname);
  const theme = useTheme();
  const compactTabs = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });

  return (
    <Box>
      <PageHeader title={t.pageTitle} subtitle={t.pageSubtitle} sx={{ mb: 2 }} />
      <Tabs
        value={active}
        aria-label={t.tabs.aria}
        variant="scrollable"
        scrollButtons={compactTabs ? true : 'auto'}
        allowScrollButtonsMobile
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        {COST_TABS.map((tab) => (
          <Tab key={tab.path} label={tab.label} value={tab.path} component={Link} to={tab.path} />
        ))}
      </Tabs>

      {active === COSTS_PATH && (
        <Suspense fallback={<Skeleton variant="rounded" height={320} role="status" aria-label={t.summary.loading} />}>
          <SummaryTab />
        </Suspense>
      )}
      {active === COSTS_PRICES_PATH && (
        <Suspense fallback={<Skeleton variant="rounded" height={320} role="status" aria-label={t.prices.loading} />}>
          <PricesTab />
        </Suspense>
      )}
      {active === COSTS_TENANTS_PATH && (
        <Suspense fallback={<Skeleton variant="rounded" height={320} role="status" aria-label={t.tenants.loading} />}>
          <TenantsTab />
        </Suspense>
      )}
      {active === COSTS_HISTORY_PATH && (
        <Suspense fallback={<Skeleton variant="rounded" height={320} role="status" aria-label={t.history.loading} />}>
          <HistoryTab />
        </Suspense>
      )}
    </Box>
  );
}
