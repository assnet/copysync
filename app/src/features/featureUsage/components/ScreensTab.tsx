import { useMemo, type ReactNode } from 'react';
import {
  Box, Button, Card, Divider, Skeleton, Stack, Table, TableBody, TableCell, TableHead, TableRow, ToggleButton, Tooltip,
  Typography, useTheme,
} from '@mui/material';
import { ChartBarBig, MonitorSmartphone, Table2 } from 'lucide-react';
import { AppIcon, EmptyState, ServiceUpdatingState } from '@/components';
import { chartColors } from '@/features/opsMetrics/chartColors';
import { HeaderHint, StickyFirstColumn } from '@/features/infraCosts/components/costParts';
import {
  clearUsageFilters, formatCount, formatInteger, formatReach, productLabel, screenFeatureUse, screenLabel,
  screensCollectionNotice, visibleFeatures, visibleScreens,
} from '../rules';
import { featureUsageStrings as S } from '../strings';
import type { UsageFeatureItem, UsagePlanFamily, UsageScreenItem, UsageScreensResponse } from '../types';
import { useUsagePage } from '../hooks/useUsagePage';
import { useUsageScreens } from '../hooks/useUsageScreens';
import { UsageRetryAlert } from './UsageSummaryGate';

const t = S.screens;

/** Linha do ranking: rótulo (tela, produto, números) e barra proporcional às contas que abriram. */
function ScreenRow({ screen, max, color }: { screen: UsageScreenItem; max: number; color: string }) {
  const pct = max > 0 ? (screen.tenants / max) * 100 : 0;
  return (
    <Box
      component="li"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 260px) minmax(0, 1fr)' },
        alignItems: 'center',
        columnGap: 1.5,
        rowGap: 0.75,
        py: 0.75,
      }}
    >
      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{screenLabel(screen.key, screen.product)}</Typography>
        <Stack
          direction="row"
          useFlexGap
          sx={{ flexWrap: 'wrap', columnGap: 0.75, rowGap: 0.25, color: 'text.secondary', typography: 'caption' }}
        >
          <Box component="span" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            {t.barValue(formatCount(screen.tenants), formatCount(screen.tenantDays))}
          </Box>
          <Box component="span" sx={{ whiteSpace: 'nowrap' }}>{productLabel(screen.product)}</Box>
        </Stack>
      </Stack>
      <Box aria-hidden sx={{ minWidth: 0, py: { xs: 0, sm: 0.5 } }}>
        <Box
          data-testid="screen-bar"
          sx={{ width: `${pct}%`, minWidth: screen.tenants > 0 ? 3 : 0, height: { xs: 10, sm: 22 }, bgcolor: color, borderRadius: 1 }}
        />
      </Box>
    </Box>
  );
}

/** Estado do resumo para a coluna cruzada: pronto (com recursos), carregando ou falhou. */
type CrossState = { status: 'ready'; features: readonly UsageFeatureItem[] } | { status: 'loading' } | { status: 'failed' };

function UsedCell({ screenKey, cross }: { screenKey: string; cross: CrossState }) {
  if (cross.status === 'loading') {
    return <Skeleton variant="text" width={32} sx={{ display: 'inline-block' }} aria-label={t.usedLoading} />;
  }
  if (cross.status === 'failed') {
    return (
      <Tooltip title={t.usedFailedHint} arrow enterTouchDelay={0} describeChild>
        <Box component="span" tabIndex={0} sx={{ color: 'text.secondary', cursor: 'help', typography: 'caption' }}>{t.usedFailed}</Box>
      </Tooltip>
    );
  }
  const used = screenFeatureUse(screenKey, cross.features);
  if (used) return <>{formatInteger(used.activeTenants)}</>;
  return (
    <Tooltip title={t.usedNone} arrow enterTouchDelay={0} describeChild>
      <Box component="span" tabIndex={0} sx={{ color: 'text.disabled', cursor: 'help' }}>{S.measures.noValue}</Box>
    </Tooltip>
  );
}

/** Denominador do "Do recorte": telas Saver pela família Saver, as demais pela de Afiliados; sem `byFamily`, o total. */
function familyPopulation(population: UsageScreensResponse['population'], family: UsagePlanFamily): number {
  return population.byFamily?.find((f) => f.family === family)?.tenants ?? population.tenants;
}

/** Tabela alternativa (acessibilidade): mesmos números do ranking + parte do recorte e o cruzamento "usaram". */
function ScreensTable({ screens, population, cross }: {
  screens: UsageScreenItem[]; population: UsageScreensResponse['population']; cross: CrossState;
}) {
  const c = t.columns;
  const shareHint = population.byFamily
    ? t.shareHelpByFamily(formatInteger(familyPopulation(population, 'AFFILIATES')), formatInteger(familyPopulation(population, 'SAVER')))
    : t.shareHelp(formatInteger(population.tenants));
  const num = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;
  return (
    <StickyFirstColumn>
      <Table size="small" aria-label={t.tableAria} sx={{ minWidth: 720 }}>
        <TableHead>
          <TableRow>
            <TableCell component="th" scope="col">{c.screen}</TableCell>
            <TableCell component="th" scope="col">{c.product}</TableCell>
            <TableCell component="th" scope="col" align="right">{c.tenants}</TableCell>
            <TableCell component="th" scope="col" align="right"><HeaderHint label={c.share} hint={shareHint} /></TableCell>
            <TableCell component="th" scope="col" align="right"><HeaderHint label={c.tenantDays} hint={t.tenantDaysHelp} /></TableCell>
            <TableCell component="th" scope="col" align="right"><HeaderHint label={c.used} hint={t.usedHelp} /></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {screens.map((sc) => {
            const total = familyPopulation(population, sc.planFamily === 'SAVER' ? 'SAVER' : 'AFFILIATES');
            return (
              <TableRow key={sc.key} hover>
                <TableCell component="th" scope="row" sx={{ fontWeight: 500, minWidth: 140 }}>{screenLabel(sc.key, sc.product)}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{productLabel(sc.product)}</TableCell>
                <TableCell align="right" sx={num}>{formatInteger(sc.tenants)}</TableCell>
                <TableCell align="right" sx={num}>{formatReach(total > 0 ? sc.tenants / total : null)}</TableCell>
                <TableCell align="right" sx={num}>{formatInteger(sc.tenantDays)}</TableCell>
                <TableCell align="right" sx={num}><UsedCell screenKey={sc.key} cross={cross} /></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </StickyFirstColumn>
  );
}

/**
 * Aba Telas (`/admin/usage/screens`, P3): ranking das telas do menu por **contas que abriram** (uma marca por conta e
 * dia, nunca número de aberturas), lido por consulta própria (`GET /admin/usage/screens`). Tabela alternativa com
 * dias-conta, "Do recorte" pela família da tela e o cruzamento com o uso do recurso (resumo lido só com a tabela aberta).
 * O ranking ignora o filtro de tipo; a coluna cruzada o segue. Produto, plano, status e internas valem.
 */
export default function ScreensTab() {
  const { filters, setFilters, query, refreshKey, summary, screensView: view, setScreensView: setView } = useUsagePage();
  const q = useUsageScreens(query, refreshKey);
  const theme = useTheme();
  const color = chartColors(theme.palette.mode).ordered[0];
  const { data } = q;
  const screens = useMemo(() => (data ? visibleScreens(data.screens, filters) : []), [data, filters]);
  // Coluna cruzada: só com o resumo pronto; sem ele, carregando (esqueleto) ou falhou (nunca "sem recurso único").
  const cross: CrossState = summary.data
    ? { status: 'ready', features: visibleFeatures(summary.data.features, filters) }
    : summary.error || summary.slow || summary.unavailable ? { status: 'failed' } : { status: 'loading' };

  if (q.unavailable && !data) return <ServiceUpdatingState onRetry={q.reload} />;
  if ((q.error || q.slow) && !data && !q.loading) return <UsageRetryAlert slow={q.slow} onRetry={q.reload} message={t.loadFailed} />;
  if (!data) {
    return (
      <Stack spacing={2} role="status" aria-label={t.loading}>
        <Skeleton variant="text" width={320} />
        <Skeleton variant="rounded" height={360} />
      </Stack>
    );
  }

  const stale = (q.error || q.slow) && !q.loading;
  const empty = screens.every((sc) => sc.tenants === 0);
  const asTable = view === 'table';
  const max = Math.max(0, ...screens.map((sc) => sc.tenants));
  const toggleLabel = asTable ? S.actions.showChart : S.actions.showTable;

  let body: ReactNode;
  if (asTable) {
    body = <ScreensTable screens={screens} population={data.population} cross={cross} />;
  } else {
    body = (
      <>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 0.5 }}>{t.tenantsAxis}</Typography>
        <Box component="figure" aria-label={t.aria} sx={{ m: 0 }}>
          <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, minWidth: 0 }}>
            {screens.map((sc) => <ScreenRow key={sc.key} screen={sc} max={max} color={color} />)}
          </Box>
        </Box>
      </>
    );
  }

  return (
    <Stack spacing={2} aria-busy={q.loading}>
      {stale && <UsageRetryAlert slow={q.slow} onRetry={q.reload} stale />}
      <Stack spacing={0.5}>
        <Typography variant="caption" color="text.secondary" component="p" role="note">{screensCollectionNotice(data)}</Typography>
        <Typography variant="caption" color="text.secondary" component="p">{t.kindIgnored}</Typography>
      </Stack>
      {empty ? (
        <EmptyState
          icon={<AppIcon icon={MonitorSmartphone} size="lg" aria-hidden />}
          title={t.emptyTitle}
          description={t.emptyDescription}
          action={<Button variant="outlined" onClick={() => setFilters(clearUsageFilters(filters))}>{S.actions.clearFilters}</Button>}
        />
      ) : (
        <Card component="section" aria-label={t.title}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', px: 2.5, pt: 2, pb: 1.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" component="h3">{t.title}</Typography>
              <Typography variant="caption" color="text.secondary">{t.subtitle}</Typography>
            </Box>
            <Tooltip title={toggleLabel}>
              <ToggleButton
                value="table"
                size="small"
                selected={asTable}
                onChange={() => setView(asTable ? 'chart' : 'table')}
                aria-label={toggleLabel}
                sx={{ minWidth: 40, minHeight: { xs: 40, sm: 32 } }}
              >
                <AppIcon icon={asTable ? ChartBarBig : Table2} size="sm" />
              </ToggleButton>
            </Tooltip>
          </Stack>
          <Divider />
          <Box sx={{ px: { xs: 1.5, sm: 2.5 }, py: 2 }}>{body}</Box>
        </Card>
      )}
    </Stack>
  );
}
