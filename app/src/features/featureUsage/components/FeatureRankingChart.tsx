import { useMemo, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box, Button, Card, Chip, Divider, Link, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography, useTheme,
} from '@mui/material';
import { ChartBarBig, Minus, Table2, TrendingDown, TrendingUp } from 'lucide-react';
import { AppIcon } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { chartColors } from '@/features/opsMetrics/chartColors';
import { HeaderHint } from '@/features/infraCosts/components/costParts';
import {
  USAGE_SORTS, adoptionCell, featureLabel, recurringCell, retentionCell, featureUsesTrend, formatCount, formatDay, formatInteger, formatReach, formatTrend,
  kindChipLabels, productLabel, rankingSlice, sortFeatures, trendTone,
} from '../rules';
import { featureUsageStrings as S } from '../strings';
import { usageFeaturePath } from '../paths';
import type { UsageFeatureItem, UsageRecurringDays, UsageSort } from '../types';
import { CoverageChip } from './CoverageChip';
import { RatioValue } from './RatioValue';

const r = S.ranking;
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

/** `wrap`: o nome quebra linha em vez de cortar com reticências (ranking no celular). */
function FeatureLink({ feature, children, wrap = false }: { feature: Pick<UsageFeatureItem, 'key'>; children: ReactNode; wrap?: boolean }) {
  return (
    <Link
      component={RouterLink}
      to={usageFeaturePath(feature.key)}
      underline="hover"
      color="text.primary"
      aria-label={S.actions.openDetail(featureLabel(feature.key))}
      sx={wrap ? { fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }
        : { fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
    >
      {children}
    </Link>
  );
}

/** Rótulo de uma barra: nome (abre o detalhe), aviso de parcial; abaixo, contas · usos, tendência e tipos. Quebra linha. */
function RankingLabel({ feature }: { feature: UsageFeatureItem }) {
  return (
    <Stack spacing={0.25} sx={{ minWidth: 0 }}>
      <Stack direction="row" useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 0.5, rowGap: 0.25, minWidth: 0 }}>
        <FeatureLink feature={feature} wrap>{featureLabel(feature.key)}</FeatureLink>
        <CoverageChip feature={feature} />
      </Stack>
      <Stack
        direction="row"
        useFlexGap
        sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 0.75, rowGap: 0.25, minWidth: 0, color: 'text.secondary', typography: 'caption' }}
      >
        <Box component="span" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {r.barValue(formatCount(feature.activeTenants), formatCount(feature.uses))}
        </Box>
        <TrendText feature={feature} />
        {feature.adoption !== null && (
          <RatioValue cell={{ ...adoptionCell(feature), value: r.adoptionChip(adoptionCell(feature).value) }} label={r.columns.adoption} />
        )}
        <KindChips feature={feature} />
      </Stack>
    </Stack>
  );
}

/**
 * Barra horizontal de uma linha (CSS, não svg: a linha cresce quando o rótulo quebra e a barra acompanha). Só visual:
 * os números estão no rótulo e na tabela; o caminho por teclado é o nome do recurso.
 */
function RankingBar({ feature, value, max, color }: { feature: UsageFeatureItem; value: number; max: number; color: string }) {
  const navigate = useNavigate();
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <Box aria-hidden sx={{ minWidth: 0, py: { xs: 0, sm: 0.5 } }}>
      <Box
        data-testid="ranking-bar"
        onClick={() => navigate(usageFeaturePath(feature.key))}
        sx={{
          width: `${pct}%`,
          minWidth: value > 0 ? 3 : 0,
          height: { xs: 10, sm: 22 },
          bgcolor: color,
          borderRadius: 1,
          cursor: 'pointer',
        }}
      />
    </Box>
  );
}

/** Linha do ranking: no celular o rótulo fica acima da barra; da tablet em diante, lado a lado. */
function RankingRow({ feature, value, max, color }: { feature: UsageFeatureItem; value: number; max: number; color: string }) {
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
      <RankingLabel feature={feature} />
      <RankingBar feature={feature} value={value} max={max} color={color} />
    </Box>
  );
}

function RankingTable({ features, recurringDays }: { features: UsageFeatureItem[]; recurringDays: UsageRecurringDays }) {
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
            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}><HeaderHint label={c.adoption} hint={S.retention.adoptionHelp} /></TableCell>
            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}><HeaderHint label={c.recurring} hint={S.retention.recurringHelp(recurringDays)} /></TableCell>
            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}><HeaderHint label={c.retention} hint={S.retention.retentionHelp} /></TableCell>
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
              <TableCell align="right" sx={cell}><RatioValue cell={adoptionCell(f)} label={c.adoption} /></TableCell>
              <TableCell align="right" sx={cell}><RatioValue cell={recurringCell(f, recurringDays)} label={c.recurring} /></TableCell>
              <TableCell align="right" sx={cell}><RatioValue cell={retentionCell(f)} label={c.retention} /></TableCell>
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
 * os usos. Clique na barra ou no nome abre o detalhe. A tabela alternativa tem os mesmos números (acessibilidade) e
 * as medidas da P3 (adoção, recorrência, retenção, com o denominador no `Tooltip`); a barra mostra só a adoção.
 */
export default function FeatureRankingChart({
  features,
  sort,
  onSortChange,
  recurringDays = 3,
}: {
  features: readonly UsageFeatureItem[];
  sort: UsageSort;
  onSortChange: (sort: UsageSort) => void;
  /** N da recorrência pedido ao resumo (texto da coluna e do denominador). */
  recurringDays?: UsageRecurringDays;
}) {
  const [view, setView] = usePersistedState<RankingView>('usage.rankingView', 'chart', { scope: 'tab', version: 1, deserialize: parseView });
  const sorted = useMemo(() => sortFeatures(features, sort), [features, sort]);
  const { visible, hidden } = rankingSlice(sorted);
  const asTable = view === 'table';
  const theme = useTheme();
  const color = chartColors(theme.palette.mode).ordered[0];
  const barValue = (f: UsageFeatureItem) => (sort === 'tenants' ? f.activeTenants : f.uses);
  const max = Math.max(0, ...visible.map(barValue));

  let body: ReactNode;
  if (sorted.length === 0) {
    body = <Typography variant="body2" color="text.secondary">{r.empty}</Typography>;
  } else if (asTable) {
    body = <RankingTable features={sorted} recurringDays={recurringDays} />;
  } else {
    body = (
      <>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 0.5 }}>
          {sort === 'tenants' ? r.tenantsAxis : r.usesAxis}
        </Typography>
        <Box component="figure" aria-label={r.aria} sx={{ m: 0 }}>
          <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, minWidth: 0 }}>
            {visible.map((f) => <RankingRow key={f.key} feature={f} value={barValue(f)} max={max} color={color} />)}
          </Box>
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
