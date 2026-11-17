import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box, Button, Card, Chip, Divider, Link, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography, useTheme,
} from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { ChartBarBig, Minus, Table2, TrendingDown, TrendingUp } from 'lucide-react';
import { AppIcon } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { chartColors } from '@/features/opsMetrics/chartColors';
import {
  USAGE_SORTS, featureLabel, featureUsesTrend, formatCount, formatDay, formatInteger, formatReach, formatTrend,
  kindChipLabels, productLabel, rankingSlice, sortFeatures, trendTone,
} from '../rules';
import { featureUsageStrings as S } from '../strings';
import { usageFeaturePath } from '../paths';
import type { UsageFeatureItem, UsageSort } from '../types';
import { CoverageChip } from './CoverageChip';

const r = S.ranking;
/** Altura de cada linha do ranking: o rótulo (HTML) e a barra (svg) dividem a mesma faixa. */
const ROW_HEIGHT = 52;
type RankingView = 'chart' | 'table';
const parseView = (raw: unknown): RankingView => (raw === 'table' ? 'table' : 'chart');

/** Chips de tipo do recurso ("ação", "automático"); o Caçador leva dois. */
function KindChips({ feature }: { feature: Pick<UsageFeatureItem, 'kinds'> }) {
  return (
    <>
      {kindChipLabels(feature.kinds).map((label) => (
        <Chip
          key={label}
          label={label}
          size="small"
          sx={{ height: 18, flexShrink: 0, '& .MuiChip-label': { px: 0.75, fontSize: 11 } }}
        />
      ))}
    </>
  );
}

/** Tendência dos usos com seta no tom (sobe/cai/neutro); o texto fica no secundário para manter contraste. */
function TrendText({ feature }: { feature: Pick<UsageFeatureItem, 'uses' | 'usesPrevious'> }) {
  const trend = featureUsesTrend(feature);
  const tone = trendTone(trend);
  const icon = tone === 'success' ? TrendingUp : tone === 'warning' ? TrendingDown : Minus;
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, whiteSpace: 'nowrap' }}>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          color: (t) => (tone === 'neutral' ? t.palette.text.disabled
            : t.palette[tone][t.palette.mode === 'light' ? 'dark' : 'main']),
        }}
      >
        <AppIcon icon={icon} size="inline" aria-hidden />
      </Box>
      {formatTrend(trend)}
    </Box>
  );
}

function FeatureLink({ feature, children }: { feature: Pick<UsageFeatureItem, 'key'>; children: ReactNode }) {
  return (
    <Link
      component={RouterLink}
      to={usageFeaturePath(feature.key)}
      underline="hover"
      color="text.primary"
      aria-label={S.actions.openDetail(featureLabel(feature.key))}
      sx={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
    >
      {children}
    </Link>
  );
}

/** Rótulo de uma barra: nome (abre o detalhe), tipos, aviso de parcial; abaixo, contas · usos e tendência. */
function RankingLabel({ feature }: { feature: UsageFeatureItem }) {
  return (
    <Stack sx={{ height: ROW_HEIGHT, justifyContent: 'center', minWidth: 0, pr: 1 }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
        <FeatureLink feature={feature}>{featureLabel(feature.key)}</FeatureLink>
        <CoverageChip feature={feature} />
      </Stack>
      <Stack
        direction="row"
        spacing={0.75}
        sx={{ alignItems: 'center', minWidth: 0, overflow: 'hidden', color: 'text.secondary', typography: 'caption' }}
      >
        <Box component="span" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {r.barValue(formatCount(feature.activeTenants), formatCount(feature.uses))}
        </Box>
        <TrendText feature={feature} />
        <KindChips feature={feature} />
      </Stack>
    </Stack>
  );
}

/** Barras horizontais alinhadas às linhas do rótulo. Só visual: os números estão nos rótulos e na tabela. */
function RankingBars({ features, sort }: { features: UsageFeatureItem[]; sort: UsageSort }) {
  const theme = useTheme();
  const navigate = useNavigate();
  const plotRef = useRef<HTMLDivElement>(null);
  const color = chartColors(theme.palette.mode).ordered[0];
  const values = features.map((f) => (sort === 'tenants' ? f.activeTenants : f.uses));
  // O svg do gráfico entraria na ordem do Tab; o caminho por teclado é o nome do recurso ao lado.
  useEffect(() => {
    plotRef.current?.querySelectorAll('svg').forEach((svg) => svg.setAttribute('tabindex', '-1'));
  });
  return (
    <Box ref={plotRef} aria-hidden sx={{ minWidth: 0 }}>
      <BarChart
        height={features.length * ROW_HEIGHT}
        layout="horizontal"
        skipAnimation
        borderRadius={4}
        hideLegend
        series={[{
          id: 'ranking',
          data: values,
          color,
          label: sort === 'tenants' ? r.tenantsAxis : r.usesAxis,
          valueFormatter: (v: number | null) => (v == null ? null : formatInteger(v)),
        }]}
        yAxis={[{
          scaleType: 'band',
          data: features.map((f) => featureLabel(f.key)),
          position: 'none',
          categoryGapRatio: 0.45,
        }]}
        xAxis={[{ position: 'none', min: 0 }]}
        margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
        onItemClick={(_, item) => {
          const f = features[item.dataIndex];
          if (f) navigate(usageFeaturePath(f.key));
        }}
        sx={{ '& .MuiBarElement-root': { cursor: 'pointer' } }}
      />
    </Box>
  );
}

function RankingTable({ features }: { features: UsageFeatureItem[] }) {
  const c = r.columns;
  const cell = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;
  return (
    <TableContainer sx={{ maxHeight: 520 }}>
      <Table size="small" stickyHeader aria-label={r.tableAria}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ position: 'sticky', left: 0, zIndex: 3, bgcolor: 'background.paper' }}>{c.feature}</TableCell>
            <TableCell>{c.product}</TableCell>
            <TableCell>{c.kinds}</TableCell>
            <TableCell align="right">{c.activeTenants}</TableCell>
            <TableCell align="right">{c.uses}</TableCell>
            <TableCell align="right">{c.reach}</TableCell>
            <TableCell align="right">{c.trend}</TableCell>
            <TableCell align="right">{c.lastUsed}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {features.map((f) => (
            <TableRow key={f.key} hover>
              <TableCell sx={{ position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper', maxWidth: 220 }}>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
                  <FeatureLink feature={f}>{featureLabel(f.key)}</FeatureLink>
                  <CoverageChip feature={f} />
                </Stack>
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{productLabel(f.product)}</TableCell>
              <TableCell>
                <Stack direction="row" spacing={0.5}><KindChips feature={f} /></Stack>
              </TableCell>
              <TableCell align="right" sx={cell}>{formatInteger(f.activeTenants)}</TableCell>
              <TableCell align="right" sx={cell}>{formatInteger(f.uses)}</TableCell>
              <TableCell align="right" sx={cell}>{formatReach(f.reach)}</TableCell>
              <TableCell align="right" sx={cell}><TrendText feature={f} /></TableCell>
              <TableCell align="right" sx={cell}>
                {f.lastUsedDay ? formatDay(f.lastUsedDay, true) : S.measures.never}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/**
 * Ranking dos recursos (chunk próprio, `lazy`): barras horizontais numa cor só, no máximo 12 + "ver todos" (abre a
 * tabela com todos). Ordenação contas/usos/tendência pelos filtros (persistida com eles); na tendência a barra mostra
 * os usos. Clique na barra ou no nome abre o detalhe. A tabela alternativa tem os mesmos números (acessibilidade).
 */
export default function FeatureRankingChart({
  features,
  sort,
  onSortChange,
}: {
  features: readonly UsageFeatureItem[];
  sort: UsageSort;
  onSortChange: (sort: UsageSort) => void;
}) {
  const [view, setView] = usePersistedState<RankingView>('usage.rankingView', 'chart', { scope: 'tab', version: 1, deserialize: parseView });
  const sorted = useMemo(() => sortFeatures(features, sort), [features, sort]);
  const { visible, hidden } = rankingSlice(sorted);
  const asTable = view === 'table';

  let body: ReactNode;
  if (sorted.length === 0) {
    body = <Typography variant="body2" color="text.secondary">{r.empty}</Typography>;
  } else if (asTable) {
    body = <RankingTable features={sorted} />;
  } else {
    body = (
      <>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 0.5 }}>
          {sort === 'tenants' ? r.tenantsAxis : r.usesAxis}
        </Typography>
        <Box
          component="figure"
          aria-label={r.aria}
          sx={{
            m: 0,
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1.4fr) minmax(0, 1fr)', sm: 'minmax(0, 260px) minmax(0, 1fr)' },
            alignItems: 'start',
          }}
        >
          <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, minWidth: 0 }}>
            {visible.map((f) => <li key={f.key}><RankingLabel feature={f} /></li>)}
          </Box>
          <RankingBars features={visible} sort={sort} />
        </Box>
        {hidden > 0 && (
          <Button size="small" onClick={() => setView('table')} sx={{ mt: 1, minHeight: 36 }}>
            {S.actions.seeAll(sorted.length)}
          </Button>
        )}
      </>
    );
  }

  const toggleLabel = asTable ? S.actions.showChart : S.actions.showTable;
  return (
    <Card component="section" aria-label={r.title} sx={{ height: '100%' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { xs: 'stretch', sm: 'flex-start' }, px: 2.5, pt: 2, pb: 1.5 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" component="h3">{r.title}</Typography>
          <Typography variant="caption" color="text.secondary">{r.subtitle}</Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={sort}
            aria-label={S.filters.sort}
            onChange={(_, next: UsageSort | null) => { if (next) onSortChange(next); }}
          >
            {USAGE_SORTS.map((s) => (
              <ToggleButton key={s} value={s} sx={{ minHeight: { xs: 40, sm: 32 }, px: 1.25, textTransform: 'none' }}>
                {S.filters.sorts[s]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
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
      </Stack>
      <Divider />
      <Box sx={{ px: { xs: 1.5, sm: 2.5 }, py: 2 }}>{body}</Box>
    </Card>
  );
}
