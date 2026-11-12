import { useId } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, AlertTitle, Box, Button, CircularProgress, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableFooter,
  TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { CircleDashed, Gauge, Receipt, TrendingUp, Users } from 'lucide-react';
import { SectionCard, ServiceUpdatingState } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { serverNow } from '@/services/serverClock';
import { PLAN_CATALOG, type PlanSlug } from '@/features/plans/catalog';
import { planName } from '@/features/planEntitlementsAdmin/strings';
import { formatDateTime } from '@/features/opsMetrics/rules';
import { HelpTip } from '@/features/opsMetrics/components/HelpTip';
import { COSTS_PRICES_PATH } from '../paths';
import {
  catalogPlanName, costMonthOptions, dayLabel, DEFAULT_COST_FILTERS, formatBrl, formatPercent, formatUsd, isPriceWarning, isProjectedMonth,
  monthLabel, perSessionByBasis, planMargin, planRowsByBasis, warningDetail,
} from '../rules';
import { infraCostsStrings as S } from '../strings';
import type {
  CostFilters, InfraCostItemView, InfraCostSplitBasis, InfraCostSummary, InfraCostWarning, InfraFxView,
  InfraNeighborPlan, InfraWorkspaceUsageView,
} from '../types';
import { useCostSummary } from '../useCostSummary';
import {
  CostTile, EstimatedChip, focusRing, HeaderHint, HintChip, Money, srOnly, StickyFirstColumn, toneColor, type CostTileProps,
} from './costParts';

const s = S.summary;
const num = (n: number, digits = 0) => n.toLocaleString('pt-BR', { maximumFractionDigits: digits });
const numCell = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;

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
          <HelpTip label={basis} text={summary.basis === 'snapshot' ? s.basisHint : s.basisHoursHint} />
        </Stack>
        <Typography variant="caption" color="text.secondary">{s.generatedAt(formatDateTime(summary.generatedAt))}</Typography>
      </Box>
      {fx ? (
        <Box sx={{ flex: '1 1 260px', minWidth: 0 }} role="group" aria-label={s.fx.label}>
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
        <Alert
          severity="info"
          sx={{ flex: '1 1 260px' }}
          action={<Button component={RouterLink} to={COSTS_PRICES_PATH} color="inherit" size="small">{s.goToPrices}</Button>}
        >
          {S.warnings.fx_missing}
        </Alert>
      )}
    </Paper>
  );
}


/* ── Filtros ───────────────────────────────────────────────────────── */

const CURRENT_MONTH = 'current';

function Filters({ filters, onChange }: { filters: CostFilters; onChange: (f: CostFilters) => void }) {
  const f = s.filters;
  // Relógio do servidor (header `X-Server-Time`): o mês corrente é o da API, não o do navegador.
  const [current, ...past] = costMonthOptions(serverNow());
  const months = filters.month && filters.month !== current && !past.includes(filters.month) ? [...past, filters.month] : past;
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap', rowGap: 2 }} role="group" aria-label={f.aria}>
      <TextField
        select
        size="small"
        label={f.month}
        value={filters.month && filters.month !== current ? filters.month : CURRENT_MONTH}
        onChange={(e) => onChange({ ...filters, month: e.target.value === CURRENT_MONTH ? null : e.target.value })}
        sx={{ minWidth: 200 }}
      >
        <MenuItem value={CURRENT_MONTH}>{f.currentMonth(monthLabel(current))}</MenuItem>
        {months.map((m) => <MenuItem key={m} value={m}>{monthLabel(m)}</MenuItem>)}
      </TextField>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <ToggleButtonGroup
          exclusive
          color="primary"
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
        {PLAN_CATALOG.map((p) => <MenuItem key={p.slug} value={p.slug}>{catalogPlanName(p.slug)}</MenuItem>)}
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
      <Typography component="span" variant="body2" sx={{ fontWeight: 600, color: toneColor(negative ? 'error' : 'success') }}>
        {formatBrl(line.marginBrl)}
      </Typography>
      <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {formatPercent(line.marginPct)}
      </Typography>
    </TableCell>
  );
}

function MarginHeader({ label, hint, projected }: { label: string; hint: string; projected: boolean }) {
  return (
    <TableCell align="right">
      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        <HeaderHint label={label} hint={hint} />
        {projected && <HintChip label={s.plans.projected} hint={s.plans.projectedHint} color="info" />}
      </Stack>
    </TableCell>
  );
}

function PlansSection({ summary, filters }: { summary: InfraCostSummary; filters: CostFilters }) {
  const p = s.plans;
  const col = p.columns;
  const connected = filters.basis === 'connected';
  const showMargin = summary.fx !== null;
  // Mês em andamento por horas: margem sobre o custo projetado para o mês cheio; mês passado, o realizado.
  const projected = isProjectedMonth(summary);
  const rows = planRowsByBasis(summary.plans, filters, projected);
  const unalloc = summary.perSession.connected;
  const stale = summary.warnings.some((w) => w.code === 'sessions_sample_stale');
  const hasTable = rows.length > 0;

  return (
    <SectionCard title={p.title} subtitle={p.subtitle} noPadding={hasTable}>
      {!hasTable ? (
        <Typography variant="body2" color="text.secondary">{p.empty}</Typography>
      ) : (
        <StickyFirstColumn>
          <Table size="small" aria-label={p.aria}>
            <TableHead>
              <TableRow>
                <TableCell>{col.plan}</TableCell>
                <TableCell align="right">{col.tenants}</TableCell>
                <TableCell align="right">{connected ? col.sessionsConnected : col.sessionsContracted}</TableCell>
                <TableCell align="right">{col.share}</TableCell>
                <TableCell align="right"><HeaderHint label={col.perTenant} hint={p.perTenantHint} /></TableCell>
                {showMargin && <MarginHeader label={col.marginMonthly} hint={p.marginHint} projected={projected} />}
                {showMargin && <MarginHeader label={col.marginAnnual} hint={p.marginAnnualHint} projected={projected} />}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((v) => {
                const row = v.plan;
                // Margem sempre na base contratadas: o filtro muda só os números por sessão.
                const margin = showMargin ? planMargin(row.planSlug, v.marginCost?.brl ?? null) : null;
                return (
                  <TableRow key={row.planSlug ?? '__none'}>
                    <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{row.planSlug ? planName(row.planSlug) : p.noPlan}</TableCell>
                    <TableCell align="right" sx={numCell}>{num(row.tenants)}</TableCell>
                    <TableCell align="right" sx={numCell}>{num(v.sessions)}</TableCell>
                    <TableCell align="right"><Money value={v.share} /></TableCell>
                    <TableCell align="right">
                      <Money value={v.perTenant} />
                      {/* Mês em andamento: a margem usa o projetado; mostrado aqui para os números baterem. */}
                      {showMargin && projected && v.marginCost && (
                        <Tooltip title={p.projectedPerTenantHint} arrow enterTouchDelay={0} describeChild>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            tabIndex={0}
                            sx={{ display: 'block', whiteSpace: 'nowrap', cursor: 'help', fontVariantNumeric: 'tabular-nums', ...focusRing }}
                          >
                            {p.projectedPerTenant(unallocCost(v.marginCost))}
                          </Typography>
                        </Tooltip>
                      )}
                    </TableCell>
                    {showMargin && <MarginCell line={margin?.monthly ?? null} />}
                    {showMargin && <MarginCell line={margin?.annual ?? null} />}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </StickyFirstColumn>
      )}
      <Box sx={hasTable ? { px: 2, pb: 2 } : undefined}>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5 }}>
          {showMargin ? S.marginLabel : S.marginHiddenNoFx}
        </Typography>
        {showMargin && projected && (
          <Typography variant="caption" color="text.secondary" component="p">{p.marginProjectedNote}</Typography>
        )}
        {connected && (
          <Typography variant="caption" color="text.secondary" component="p" role="note">
            {unalloc.unallocatedSessions === null
              ? (stale ? s.unallocatedStale : p.unallocatedNoSample)
              : p.unallocated(num(unalloc.unallocatedSessions), unallocCost(unalloc.unallocatedCost))}
          </Typography>
        )}
      </Box>
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
      <TableCell align="right" sx={{ color: 'text.secondary', position: 'relative' }}>
        {/* A explicação do "—" fica no cabeçalho da coluna; o leitor de tela ouve o texto.
            `position: relative` prende o `srOnly` (absoluto) na célula: sem isso ele escapa da tabela e a página rola. */}
        <span aria-hidden>{S.noValue}</span>
        <Box component="span" sx={srOnly}>{s.services.noNeighbor}</Box>
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
        {/* Medido por hora é média do mês (ex.: 3,42 instâncias): arredondar para inteiro esconde o fracionado. */}
        <Typography variant="body2" component="span">{num(item.quantity, item.quantitySource === 'measured_hours' ? 2 : 0)}</Typography>
        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center', mt: 0.25 }}>
          <Typography variant="caption" color="text.secondary">{S.quantitySource[item.quantitySource]}</Typography>
          {item.estimated && <EstimatedChip />}
        </Stack>
      </TableCell>
      <TableCell align="right">
        {item.cost ? (
          <Money value={item.cost} />
        ) : (
          <Tooltip title={sv.noPrice} arrow enterTouchDelay={0} describeChild>
            <Box
              component="span"
              tabIndex={0}
              aria-label={sv.noPrice}
              sx={{ color: toneColor('warning'), cursor: 'help', fontWeight: 600, ...focusRing }}
            >
              {S.noValue}
            </Box>
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
        <StickyFirstColumn>
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
        </StickyFirstColumn>
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
            {usage.source === 'measured' && <HintChip label={w.measured} hint={w.measuredHint} color="success" />}
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
      <StickyFirstColumn>
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
              {/* Rótulo numa célula só: a primeira coluna é fixa e não pode cobrir o valor ao rolar. */}
              <TableCell sx={{ fontWeight: 700, color: 'text.primary', whiteSpace: 'nowrap' }}>{w.total}</TableCell>
              <TableCell colSpan={3} />
              <TableCell align="right"><Money value={ws.total} strong /></TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </StickyFirstColumn>
    </SectionCard>
  );
}

/* ── Avisos ────────────────────────────────────────────────────────── */

const WARNINGS_COLLAPSED = 3;

/** Avisos num único alerta com lista; acima de 3, recolhe o resto. */
function Warnings({ warnings, items }: { warnings: InfraCostWarning[]; items: InfraCostItemView[] }) {
  const [expanded, setExpanded] = usePersistedState<boolean>('costs.warningsExpanded', false, { scope: 'tab' });
  const listId = useId();
  // `fx_missing` já aparece na faixa da cotação.
  const list = warnings.filter((w) => w.code !== 'fx_missing');
  if (list.length === 0) return null;
  const hidden = list.length - WARNINGS_COLLAPSED;
  const shown = expanded || hidden <= 0 ? list : list.slice(0, WARNINGS_COLLAPSED);
  return (
    <Alert
      severity="warning"
      role="region"
      aria-label={s.warningsTitle}
      action={list.some((w) => isPriceWarning(w.code)) ? (
        <Button component={RouterLink} to={COSTS_PRICES_PATH} color="inherit" size="small">{s.goToPrices}</Button>
      ) : undefined}
    >
      <AlertTitle>{s.warningsTitle}</AlertTitle>
      <Box component="ul" id={listId} sx={{ m: 0, pl: 2.5 }}>
        {shown.map((w, i) => {
          const detail = warningDetail(w, items);
          return (
            <Box component="li" key={`${w.code}-${i}`} sx={{ '& + &': { mt: 0.5 } }}>
              {S.warnings[w.code]}
              {detail && <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>{detail}</Typography>}
            </Box>
          );
        })}
      </Box>
      {hidden > 0 && (
        <Button color="inherit" size="small" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={listId} sx={{ mt: 0.5, ml: -0.75 }}>
          {expanded ? s.warningsLess : s.warningsMore(hidden)}
        </Button>
      )}
    </Alert>
  );
}

/* ── Cartões ───────────────────────────────────────────────────────── */

function Tiles({ summary, filters }: { summary: InfraCostSummary; filters: CostFilters }) {
  const c = s.cards;
  const t = summary.totals;
  const connected = filters.basis === 'connected';
  const basis = perSessionByBasis(summary, filters.basis);
  const fixedVariable = c.fixedVariable(formatUsd(t.fixed.usd), formatUsd(t.variable.usd));
  // Mês em andamento por horas: o total é o realizado até agora e a projeção vem ao lado; mês passado já é cheio.
  const inProgress = isProjectedMonth(summary);
  const hours = summary.basis === 'hours';
  const conn = summary.perSession.connected;
  const sessionHourContext = connected && hours && conn.sessionHours != null
    ? [c.sessionHours(num(conn.sessionHours)), conn.perSessionHour ? c.perSessionHour(formatUsd(conn.perSessionHour.usd)) : null]
      .filter(Boolean).join(' · ')
    : null;
  const tiles: CostTileProps[] = [
    {
      ...(inProgress ? c.totalSoFar : c.total), icon: Receipt, value: t.total, context: fixedVariable,
      badge: summary.totalIsPartial ? <HintChip label={c.partial} hint={c.partialHint} color="warning" /> : undefined,
    },
    ...(inProgress && t.projected ? [{ ...c.projected, icon: TrendingUp, value: t.projected }] : []),
    {
      label: c.perSession.label, help: connected ? c.perSession.helpConnected : c.perSession.helpContracted,
      icon: Users, value: basis.perSession, context: sessionHourContext ?? c.perSession.sessions(num(basis.sessions, 2)),
    },
    // Ociosidade só na leitura por sessão-hora (COST-12): mostrada, não rateada.
    ...(connected && hours ? [{
      label: c.idle.label, help: c.idle.help, icon: CircleDashed, value: summary.idleCapacity ?? null, emptyText: c.idle.empty, context: c.idle.outOfSplit,
    }] : []),
    // Custo marginal nulo = sem preço do servidor de sessões (não falta amostra).
    { ...c.marginal, icon: Gauge, value: summary.marginalPerSession, emptyText: s.noPrice },
  ];
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        // 5 cartões numa linha em 1440 quebram rótulo e BRL: até 4 por linha no lg, todos só no xl.
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          sm: 'repeat(2, minmax(0, 1fr))',
          lg: `repeat(${tiles.length > 4 ? 3 : tiles.length}, minmax(0, 1fr))`,
          xl: `repeat(${tiles.length}, minmax(0, 1fr))`,
        },
      }}
    >
      {tiles.map((tile) => <CostTile key={tile.label} {...tile} />)}
    </Box>
  );
}

/** Aba Resumo (COST-07): cotação, cartões, avisos, por plano com margem, por serviço e workspace. */
export default function SummaryTab() {
  const [filters, setFilters] = usePersistedState<CostFilters>('costs.filters', DEFAULT_COST_FILTERS, { scope: 'tab' });
  const q = useCostSummary(filters.month);
  const { data } = q;

  const filtersBar = <Filters filters={filters} onChange={setFilters} />;

  if (q.monthUnavailable && !q.loading) {
    return (
      <Stack spacing={2}>
        {filtersBar}
        <Alert
          severity="info"
          action={(
            <Button color="inherit" size="small" sx={{ whiteSpace: 'nowrap' }} onClick={() => setFilters({ ...filters, month: null })}>
              {s.backToCurrentMonth}
            </Button>
          )}
        >
          {s.monthEmpty(monthLabel(filters.month ?? ''))}
        </Alert>
      </Stack>
    );
  }
  if (q.unavailable && !data) return <ServiceUpdatingState onRetry={q.reload} />;
  if (q.slow && !data && !q.loading) {
    return (
      <Alert severity="warning" action={<Button color="inherit" size="small" sx={{ whiteSpace: 'nowrap' }} onClick={() => void q.reload()}>{S.retry}</Button>}>
        {S.errors.readSlow}
      </Alert>
    );
  }
  if (q.loading && !data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress aria-label={s.loading} />
      </Box>
    );
  }
  if (q.error || !data) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" sx={{ whiteSpace: 'nowrap' }} onClick={() => void q.reload()}>{S.retry}</Button>}>
        {q.error ?? S.errors.loadFailed}
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <FxBand fx={data.fx} summary={data} />
      {filtersBar}
      <Tiles summary={data} filters={filters} />
      <Warnings warnings={data.warnings} items={data.items} />
      <PlansSection summary={data} filters={filters} />
      <ServicesSection summary={data} />
      <WorkspaceSection summary={data} />
    </Stack>
  );
}
