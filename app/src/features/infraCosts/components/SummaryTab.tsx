import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, CircularProgress, Grid, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableFooter,
  TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { Gauge, Receipt, TrendingUp, Users } from 'lucide-react';
import { SectionCard, ServiceUpdatingState } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { PLAN_CATALOG, type PlanSlug } from '@/features/plans/catalog';
import { planName } from '@/features/planEntitlementsAdmin/strings';
import { formatDateTime } from '@/features/opsMetrics/rules';
import { HelpTip } from '@/features/opsMetrics/components/HelpTip';
import { sortPlansByCatalog } from '@/features/workersAdmin/rules';
import { COSTS_PRICES_PATH } from '../paths';
import { catalogSlugOf, DEFAULT_COST_FILTERS, formatBrl, formatPercent, formatUsd, planMargin } from '../rules';
import { infraCostsStrings as S } from '../strings';
import type {
  CostFilters, InfraCostItemView, InfraCostPlanView, InfraCostSplitBasis, InfraCostSummary, InfraCostWarning, InfraFxView,
  InfraNeighborPlan, InfraWorkspaceUsageView,
} from '../types';
import { useCostSummary } from '../useCostSummary';
import { CostTile, EstimatedChip, HeaderHint, HintChip, Money, type CostTileProps } from './costParts';

const s = S.summary;
const num = (n: number, digits = 0) => n.toLocaleString('pt-BR', { maximumFractionDigits: digits });
const numCell = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;

/** `YYYY-MM` → "novembro de 2026". */
export function monthLabel(month: string): string {
  const d = new Date(`${month}-01T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? month : d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** `YYYY-MM-DD` → `DD/MM/YYYY`. */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-');
  return y && m && d ? `${d}/${m}/${y}` : date;
}

/** Avisos que se resolvem na aba Preços. */
const PRICE_WARNINGS = new Set<InfraCostWarning['code']>(['config_drift', 'plan_without_price', 'storage_to_confirm', 'model_without_price', 'fx_missing']);

function warningDetail(w: InfraCostWarning): string | null {
  const d = s.warningDetail;
  const parts = [
    w.resourceKey ?? w.key ? d.resource((w.resourceKey ?? w.key)!) : null,
    w.plan ? d.plan(w.plan) : null,
    w.field ? d.field(w.field) : null,
    w.model ? d.model(w.model) : null,
    typeof w.count === 'number' ? d.count(w.count) : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/* ── Cotação ───────────────────────────────────────────────────────── */

function FxBand({ fx, summary }: { fx: InfraFxView | null; summary: InfraCostSummary }) {
  const basis = summary.basis === 'snapshot' ? s.basisSnapshot : s.basisHours;
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, borderLeft: 4, borderLeftColor: fx?.stale ? 'warning.main' : 'primary.main', display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}
    >
      <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{s.monthOf(monthLabel(summary.month))}</Typography>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary">{basis}</Typography>
          <HelpTip label={basis} text={s.basisHint} />
        </Stack>
        <Typography variant="caption" color="text.secondary">{s.generatedAt(formatDateTime(summary.generatedAt))}</Typography>
      </Box>
      {fx ? (
        <Box sx={{ flex: '1 1 260px', minWidth: 0 }} aria-label={s.fx.label}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary">{s.fx.label}</Typography>
            <HelpTip label={s.fx.label} text={s.fx.hint} />
            {fx.stale && <HintChip label={s.fx.stale} hint={s.fx.staleHint} color="warning" />}
          </Stack>
          <Typography variant="h6" component="p" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {s.fx.perUsd(`R$ ${fx.rate.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`)}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="p">
            {`${s.fx.dateOf(dayLabel(fx.referenceDate))}, ${s.fx.source(S.fxSource[fx.source])}`}
          </Typography>
          {(fx.source === 'ptax' || fx.source === 'sgs') && (
            <Typography variant="caption" color="text.secondary" component="p">{S.fxSourceAttribution}</Typography>
          )}
        </Box>
      ) : (
        <Alert severity="info" sx={{ flex: '1 1 260px' }}>{S.warnings.fx_missing}</Alert>
      )}
    </Paper>
  );
}


/* ── Filtros ───────────────────────────────────────────────────────── */

function Filters({ filters, onChange }: { filters: CostFilters; onChange: (f: CostFilters) => void }) {
  const f = s.filters;
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }} role="group" aria-label={f.aria}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={filters.basis}
          aria-label={f.basis}
          onChange={(_, v: InfraCostSplitBasis | null) => v && onChange({ ...filters, basis: v })}
        >
          <ToggleButton value="contracted">{f.contracted}</ToggleButton>
          <ToggleButton value="connected">{f.connected}</ToggleButton>
        </ToggleButtonGroup>
        <HelpTip label={f.basis} text={f.basisHint} />
      </Stack>
      <TextField
        select
        size="small"
        label={f.plan}
        value={filters.plan}
        onChange={(e) => onChange({ ...filters, plan: e.target.value as PlanSlug | 'all' })}
        sx={{ minWidth: 200 }}
      >
        <MenuItem value="all">{f.allPlans}</MenuItem>
        {PLAN_CATALOG.map((p) => <MenuItem key={p.slug} value={p.slug}>{p.name}</MenuItem>)}
      </TextField>
    </Stack>
  );
}

/* ── Por plano ─────────────────────────────────────────────────────── */

function MarginCell({ line }: { line: { marginBrl: number; marginPct: number | null } | null }) {
  if (!line) return <TableCell align="right" sx={{ color: 'text.secondary' }}>{S.noValue}</TableCell>;
  const negative = line.marginBrl < 0;
  return (
    <TableCell align="right" sx={numCell}>
      <Typography component="span" variant="body2" sx={{ fontWeight: 600, color: negative ? 'error.main' : 'success.main' }}>
        {formatBrl(line.marginBrl)}
      </Typography>
      <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {formatPercent(line.marginPct)}
      </Typography>
    </TableCell>
  );
}

function PlansSection({ summary, filters }: { summary: InfraCostSummary; filters: CostFilters }) {
  const p = s.plans;
  const col = p.columns;
  const connected = filters.basis === 'connected';
  const showMargin = summary.fx !== null;
  const rows = sortPlansByCatalog(summary.plans).filter(
    (row) => filters.plan === 'all' || catalogSlugOf(row.planSlug) === filters.plan,
  );
  const view = (row: InfraCostPlanView) => ({
    sessions: connected ? row.connectedSessions : row.contractedSessions,
    share: connected ? row.connectedShare : row.share,
    perTenant: connected ? row.connectedCostPerTenant : row.costPerTenant,
  });
  const unalloc = summary.perSession.connected;

  return (
    <SectionCard title={p.title} subtitle={p.subtitle}>
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{p.empty}</Typography>
      ) : (
        <TableContainer>
          <Table size="small" aria-label={p.aria}>
            <TableHead>
              <TableRow>
                <TableCell>{col.plan}</TableCell>
                <TableCell align="right">{col.tenants}</TableCell>
                <TableCell align="right">{connected ? col.sessionsConnected : col.sessionsContracted}</TableCell>
                <TableCell align="right">{col.share}</TableCell>
                <TableCell align="right"><HeaderHint label={col.perTenant} hint={p.perTenantHint} /></TableCell>
                {showMargin && <TableCell align="right"><HeaderHint label={col.marginMonthly} hint={p.marginHint} /></TableCell>}
                {showMargin && <TableCell align="right"><HeaderHint label={col.marginAnnual} hint={p.marginAnnualHint} /></TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const v = view(row);
                const margin = showMargin ? planMargin(row.planSlug, v.perTenant?.brl ?? null) : null;
                return (
                  <TableRow key={row.planSlug ?? '__none'}>
                    <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{row.planSlug ? planName(row.planSlug) : p.noPlan}</TableCell>
                    <TableCell align="right" sx={numCell}>{num(row.tenants)}</TableCell>
                    <TableCell align="right" sx={numCell}>{num(v.sessions)}</TableCell>
                    <TableCell align="right"><Money value={v.share} /></TableCell>
                    <TableCell align="right"><Money value={v.perTenant} /></TableCell>
                    {showMargin && <MarginCell line={margin?.monthly ?? null} />}
                    {showMargin && <MarginCell line={margin?.annual ?? null} />}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5 }}>
        {showMargin ? S.marginLabel : S.marginHiddenNoFx}
      </Typography>
      {connected && (
        <Typography variant="caption" color="text.secondary" component="p" role="note">
          {unalloc.unallocatedSessions === null
            ? p.unallocatedNoSample
            : p.unallocated(num(unalloc.unallocatedSessions), unallocCost(unalloc.unallocatedCost))}
        </Typography>
      )}
    </SectionCard>
  );
}

function unallocCost(m: { usd: number; brl: number | null } | null): string {
  if (!m) return S.noValue;
  const usd = formatUsd(m.usd);
  return m.brl === null ? usd : `${usd} (${formatBrl(m.brl)})`;
}

/* ── Por serviço ───────────────────────────────────────────────────── */

function NeighborCell({ n }: { n: InfraNeighborPlan | null | undefined }) {
  if (!n) {
    return (
      <TableCell align="right">
        <Tooltip title={s.services.noNeighbor} arrow enterTouchDelay={0}>
          <Box component="span" tabIndex={0} aria-label={s.services.noNeighbor} sx={{ color: 'text.secondary', cursor: 'help' }}>{S.noValue}</Box>
        </Tooltip>
      </TableCell>
    );
  }
  return (
    <TableCell align="right">
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'inherit' }}>{n.plan}</Typography>
      <Money value={n.diff} signed />
    </TableCell>
  );
}

function ServiceRow({ item }: { item: InfraCostItemView }) {
  const sv = s.services;
  // Texto vazio (a API manda `''` no `planLabel`) conta como ausente.
  const sub = item.plan?.trim() || item.planLabel?.trim() || null;
  return (
    <TableRow>
      <TableCell sx={{ minWidth: 160 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.label}</Typography>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
          <Typography variant="caption" color="text.secondary">{sub ? `${S.category[item.category]}, ${sub}` : S.category[item.category]}</Typography>
          {item.allocation === 'excluded' && <HintChip label={sv.excluded} hint={sv.excludedHint} />}
        </Stack>
      </TableCell>
      <TableCell align="right" sx={numCell}>
        <Typography variant="body2" component="span">{num(item.quantity)}</Typography>
        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center', mt: 0.25 }}>
          <Typography variant="caption" color="text.secondary">{S.quantitySource[item.quantitySource]}</Typography>
          {item.estimated && <EstimatedChip />}
        </Stack>
      </TableCell>
      <TableCell align="right">
        {item.cost ? (
          <Money value={item.cost} />
        ) : (
          <Tooltip title={sv.noPrice} arrow enterTouchDelay={0}>
            <Box component="span" tabIndex={0} aria-label={sv.noPrice} sx={{ color: 'warning.main', cursor: 'help', fontWeight: 600 }}>{S.noValue}</Box>
          </Tooltip>
        )}
        {item.storageToConfirm && (
          <Box sx={{ mt: 0.5 }}><HintChip label={S.storageToConfirm} hint={sv.storageHint} color="warning" /></Box>
        )}
      </TableCell>
      <NeighborCell n={item.neighbors?.lower} />
      <NeighborCell n={item.neighbors?.upper} />
    </TableRow>
  );
}

function ServicesSection({ summary }: { summary: InfraCostSummary }) {
  const sv = s.services;
  const col = sv.columns;
  return (
    <SectionCard title={sv.title} subtitle={sv.subtitle} noPadding={summary.items.length > 0}>
      {summary.items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{sv.empty}</Typography>
      ) : (
        <TableContainer>
          <Table size="small" aria-label={sv.aria}>
            <TableHead>
              <TableRow>
                <TableCell>{col.service}</TableCell>
                <TableCell align="right">{col.quantity}</TableCell>
                <TableCell align="right">{col.cost}</TableCell>
                <TableCell align="right"><HeaderHint label={col.lower} hint={sv.neighborsHint} /></TableCell>
                <TableCell align="right"><HeaderHint label={col.upper} hint={sv.neighborsHint} /></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {summary.items.map((item) => <ServiceRow key={item.key} item={item} />)}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </SectionCard>
  );
}

/* ── Workspace ─────────────────────────────────────────────────────── */

function WorkspaceRow({ label, usage, unit }: { label: string; usage: InfraWorkspaceUsageView; unit: (n: string) => string }) {
  const w = s.workspace;
  return (
    <TableRow>
      <TableCell sx={{ fontWeight: 600 }}>{label}</TableCell>
      <TableCell align="right" sx={numCell}>{unit(num(usage.included, 2))}</TableCell>
      <TableCell align="right" sx={numCell}>
        {usage.consumed === null ? (
          <Typography component="span" variant="body2" color="text.secondary">{S.noSample}</Typography>
        ) : (
          <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
            <span>{unit(num(usage.consumed, 2))}</span>
            {usage.source === 'manual' && <EstimatedChip hint={w.manualHint} />}
          </Stack>
        )}
      </TableCell>
      <TableCell align="right" sx={numCell}>{unit(num(usage.overage, 2))}</TableCell>
      <TableCell align="right"><Money value={usage.cost} /></TableCell>
    </TableRow>
  );
}

function WorkspaceSection({ summary }: { summary: InfraCostSummary }) {
  const w = s.workspace;
  const ws = summary.workspace;
  return (
    <SectionCard title={w.title} subtitle={w.subtitle(ws.planLabel)} noPadding>
      <TableContainer>
        <Table size="small" aria-label={w.aria}>
          <TableHead>
            <TableRow>
              <TableCell>{w.columns.metric}</TableCell>
              <TableCell align="right">{w.columns.included}</TableCell>
              <TableCell align="right">{w.columns.consumed}</TableCell>
              <TableCell align="right">{w.columns.overage}</TableCell>
              <TableCell align="right">{w.columns.cost}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <WorkspaceRow label={w.bandwidth} usage={ws.bandwidth} unit={w.gb} />
            <WorkspaceRow label={w.build} usage={ws.build} unit={w.minutes} />
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} sx={{ fontWeight: 600, color: 'text.primary' }}>{w.total}</TableCell>
              <TableCell align="right"><Money value={ws.total} /></TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableContainer>
    </SectionCard>
  );
}

/* ── Avisos ────────────────────────────────────────────────────────── */

function Warnings({ warnings }: { warnings: InfraCostWarning[] }) {
  // `fx_missing` já aparece na faixa da cotação.
  const list = warnings.filter((w) => w.code !== 'fx_missing');
  if (list.length === 0) return null;
  return (
    <Stack spacing={1} role="region" aria-label={s.warningsTitle}>
      {list.map((w, i) => {
        const detail = warningDetail(w);
        return (
          <Alert
            key={`${w.code}-${i}`}
            severity="warning"
            action={PRICE_WARNINGS.has(w.code) ? (
              <Button component={RouterLink} to={COSTS_PRICES_PATH} color="inherit" size="small">{s.goToPrices}</Button>
            ) : undefined}
          >
            {S.warnings[w.code]}
            {detail && <Typography component="span" variant="body2" sx={{ display: 'block', opacity: 0.85 }}>{detail}</Typography>}
          </Alert>
        );
      })}
    </Stack>
  );
}

/* ── Cartões ───────────────────────────────────────────────────────── */

function Tiles({ summary, filters }: { summary: InfraCostSummary; filters: CostFilters }) {
  const c = s.cards;
  const t = summary.totals;
  const connected = filters.basis === 'connected';
  const basis = connected ? summary.perSession.connected : summary.perSession.contracted;
  const fixedVariable = c.fixedVariable(formatUsd(t.fixed.usd), formatUsd(t.variable.usd));
  const tiles: CostTileProps[] = [
    {
      ...c.total, icon: Receipt, value: t.total, context: fixedVariable,
      badge: summary.totalIsPartial ? <HintChip label={c.partial} hint={c.partialHint} color="warning" /> : undefined,
    },
    ...(t.projected ? [{ ...c.projected, icon: TrendingUp, value: t.projected }] : []),
    {
      label: c.perSession.label, help: connected ? c.perSession.helpConnected : c.perSession.helpContracted,
      icon: Users, value: basis.perSession, context: c.perSession.sessions(num(basis.sessions)),
    },
    { ...c.marginal, icon: Gauge, value: summary.marginalPerSession },
  ];
  return (
    <Grid container spacing={2}>
      {tiles.map((tile) => (
        <Grid item xs={12} sm={6} lg={12 / tiles.length} key={tile.label}><CostTile {...tile} /></Grid>
      ))}
    </Grid>
  );
}

/** Aba Resumo (COST-07): cotação, cartões, avisos, por plano com margem, por serviço e workspace. */
export default function SummaryTab() {
  const [filters, setFilters] = usePersistedState<CostFilters>('costs.filters', DEFAULT_COST_FILTERS, { scope: 'tab' });
  const q = useCostSummary(filters.month);
  const { data } = q;

  if (q.unavailable && !data) return <ServiceUpdatingState onRetry={q.reload} />;
  if (q.loading && !data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress aria-label={s.loading} />
      </Box>
    );
  }
  if (q.error || !data) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void q.reload()}>{S.retry}</Button>}>
        {q.error ?? S.errors.loadFailed}
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <FxBand fx={data.fx} summary={data} />
      <Filters filters={filters} onChange={setFilters} />
      <Tiles summary={data} filters={filters} />
      <Warnings warnings={data.warnings} />
      <PlansSection summary={data} filters={filters} />
      <ServicesSection summary={data} />
      <WorkspaceSection summary={data} />
    </Stack>
  );
}
