import { lazy, Suspense } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Box, Skeleton, Tab, Tabs, useMediaQuery, useTheme } from '@mui/material';
import { PageHeader } from '@/components';
import { infraCostsStrings as t } from '@/features/infraCosts/strings';
import { COSTS_PATH } from '@/features/infraCosts/paths';

/** Aba Resumo em chunk próprio (cartões, tabelas por plano e por serviço). */
const SummaryTab = lazy(() => import('@/features/infraCosts/components/SummaryTab'));

/** Abas pela URL: caminho → rótulo. A ativa é a de prefixo mais longo que casa com o caminho. */
export const COST_TABS: { path: string; label: string }[] = [
  { path: COSTS_PATH, label: t.tabs.summary },
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
        <Suspense fallback={<Skeleton variant="rounded" height={320} aria-label={t.summary.loading} />}>
          <SummaryTab />
        </Suspense>
      )}
    </Box>
  );
}
