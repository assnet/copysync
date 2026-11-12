import { useEffect, useRef } from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { Hourglass, Lock } from 'lucide-react';
import { AppIcon, SectionCard, ServiceUpdatingState } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Blurred, useBlur } from '@/features/privacy';
import { planName } from '@/features/planEntitlementsAdmin/strings';
import { HelpTip } from '@/features/opsMetrics/components/HelpTip';
import { dayLabel, DEFAULT_COST_FILTERS, formatBrl, formatPercent, formatUsd, monthLabel, planMargin, tenantMarginCost } from '../rules';
import { infraCostsStrings as S } from '../strings';
import type { CostFilters, InfraCostTenantsPage, InfraCostTenantView, InfraMoney } from '../types';
import { useCostTenants } from '../useCostTenants';
import { CostFiltersBar } from './CostFiltersBar';
import { HeaderHint, HintChip, Money, StickyFirstColumn, toneColor } from './costParts';

const t = S.tenants;
const col = t.columns;
const num = (n: number, digits = 0) => n.toLocaleString('pt-BR', { maximumFractionDigits: digits });
const numCell = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;
const rateText = (rate: number) => `R$ ${rate.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;

function moneyText(v: InfraMoney | null | undefined): string {
  if (!v) return formatUsd(0);
  return v.brl === null ? formatUsd(v.usd) : `${formatUsd(v.usd)} (${formatBrl(v.brl)})`;
}

/** Faixa do estado do mês: congelado no fechamento × estimativa do mês em andamento. */
function StatusBand({ page }: { page: Omit<InfraCostTenantsPage, 'tenants' | 'nextCursor'> }) {
  const { status, fx } = page;
  const closed = status === 'closed';
  const label = closed ? t.statusClosed : t.statusOpen;
  // Foto do momento (sem snapshot) não tem base: a lista vem vazia.
  const basisKey = page.basis === 'snapshot' || page.sharedBasis === undefined ? null : page.sharedBasis ?? 'none';
  return (
    <Paper
      variant="outlined"
      role="status"
      sx={{ p: 2, borderLeft: 4, borderLeftColor: closed ? 'primary.main' : 'info.main', display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 1, alignItems: 'center' }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flex: '1 1 260px', minWidth: 0 }}>
        <Box component="span" sx={{ display: 'inline-flex', color: toneColor(closed ? 'success' : 'info') }}>
          <AppIcon icon={closed ? Lock : Hourglass} size="sm" aria-hidden />
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0 }}>{label}</Typography>
        <HelpTip label={label} text={closed ? t.statusClosedHint : t.statusOpenHint} />
      </Stack>
      <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
        {basisKey && (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" sx={{ color: basisKey === 'contracted' ? 'text.secondary' : toneColor('warning'), minWidth: 0 }}>
              {t.sharedBasis[basisKey]}
            </Typography>
            <HelpTip label={t.sharedBasis[basisKey]} text={t.sharedBasisHint[basisKey]} />
          </Stack>
        )}
        <Typography variant="caption" color="text.secondary" component="p">
          {fx ? t.fx(rateText(fx.rate), dayLabel(fx.referenceDate), S.fxSource[fx.source]) : t.noFx}
        </Typography>
      </Box>
    </Paper>
  );
}

function MarginCell({ row, status }: { row: InfraCostTenantView; status: InfraCostTenantsPage['status'] }) {
  const cost = tenantMarginCost(row, status);
  const line = cost ? planMargin(row.planSlug, cost.brl)?.monthly ?? null : null;
  if (!line) return <TableCell align="right" sx={{ color: 'text.secondary' }}>{S.noValue}</TableCell>;
  return (
    <TableCell align="right" sx={numCell}>
      <Typography component="span" variant="body2" sx={{ fontWeight: 600, color: toneColor(line.marginBrl < 0 ? 'error' : 'success') }}>
        {formatBrl(line.marginBrl)}
      </Typography>
      <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {formatPercent(line.marginPct)}
      </Typography>
    </TableCell>
  );
}

function TenantRow({ row, status, showMargin }: { row: InfraCostTenantView; status: InfraCostTenantsPage['status']; showMargin: boolean }) {
  const blurName = useBlur('costs.tenantName');
  return (
    <TableRow>
      {/* Nome quebra em linhas: a coluna fixa não pode ocupar a tela do celular. */}
      <TableCell sx={{ fontWeight: 600, minWidth: 120, maxWidth: { xs: 150, sm: 260 }, overflowWrap: 'anywhere' }}>
        <Blurred when={blurName} inline radius={5}>{row.tenantName}</Blurred>
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.planSlug ? planName(row.planSlug) : S.summary.plans.noPlan}</TableCell>
      <TableCell align="right" sx={numCell}>{num(row.contractedSessions, 2)}</TableCell>
      <TableCell align="right" sx={numCell}>{num(row.sessionHours)}</TableCell>
      <TableCell align="right"><Money layout="table" value={row.shared} /></TableCell>
      <TableCell align="right"><Money layout="table" value={row.ai} /></TableCell>
      <TableCell align="right"><Money layout="table" value={row.total} strong /></TableCell>
      {showMargin && <MarginCell row={row} status={status} />}
    </TableRow>
  );
}

function TenantsTable({ q }: { q: ReturnType<typeof useCostTenants> }) {
  const meta = q.meta!;
  const showMargin = meta.fx !== null;
  const projected = meta.status === 'open' && q.rows.some((r) => r.projectedShared !== null);
  return (
    <>
      <StickyFirstColumn>
        <Table size="small" aria-label={t.aria}>
          <TableHead>
            <TableRow>
              <TableCell>{col.tenant}</TableCell>
              <TableCell>{col.plan}</TableCell>
              <TableCell align="right"><HeaderHint label={col.sessions} hint={col.sessionsHint} /></TableCell>
              <TableCell align="right"><HeaderHint label={col.sessionHours} hint={col.sessionHoursHint} /></TableCell>
              <TableCell align="right"><HeaderHint label={col.shared} hint={col.sharedHint} /></TableCell>
              <TableCell align="right"><HeaderHint label={col.ai} hint={col.aiHint} /></TableCell>
              <TableCell align="right">{col.total}</TableCell>
              {showMargin && (
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                    {/* Fechado: custo congelado, preço do plano não (é texto do catálogo) — o rótulo diz qual preço. */}
                    {meta.status === 'closed'
                      ? <HeaderHint label={t.marginCurrentPrice} hint={t.marginCurrentPriceHint} />
                      : <span>{col.margin}</span>}
                    {projected && <HintChip label={t.marginProjected} hint={t.marginProjectedHint} color="info" />}
                  </Stack>
                </TableCell>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {q.rows.map((row) => <TenantRow key={row.tenantId} row={row} status={meta.status} showMargin={showMargin} />)}
          </TableBody>
        </Table>
      </StickyFirstColumn>
      <Stack spacing={1} sx={{ px: 2, py: 1.5 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="caption" color="text.secondary" aria-live="polite">
            {/* Mês aberto vem por nome (o custo é calculado só na página); fechado, pelo custo congelado. */}
            {`${t.shown(q.rows.length)}. ${meta.status === 'closed' ? t.orderClosed : t.orderOpen}${q.hasMore ? '' : ` ${t.allLoaded}`}`}
          </Typography>
          {q.hasMore && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => void q.loadMore()}
              disabled={q.loadingMore}
              startIcon={q.loadingMore ? <CircularProgress size={14} aria-label={t.loadingMore} /> : undefined}
            >
              {t.loadMore}
            </Button>
          )}
        </Stack>
        {q.moreError && (
          <Alert severity="error" action={<Button color="inherit" size="small" sx={{ whiteSpace: 'nowrap' }} onClick={() => void q.loadMore()}>{S.retry}</Button>}>
            {q.moreError}
          </Alert>
        )}
        {meta.status === 'closed' && (meta.excluded || meta.unallocated) && (
          <Typography variant="caption" color="text.secondary" component="p" role="note">
            {t.outside(moneyText(meta.excluded), moneyText(meta.unallocated))}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary" component="p">{showMargin ? t.marginNote : S.marginHiddenNoFx}</Typography>
      </Stack>
    </>
  );
}

/**
 * Aviso do cursor inválido: aparece depois de a lista recarregar do início. Recebe o foco ao montar (o botão
 * "Carregar mais" que estava focado sumiu com a recarga), com `tabIndex={-1}` para não entrar no Tab.
 */
function CursorResetNotice() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return <Alert ref={ref} severity="info" role="status" tabIndex={-1} sx={{ '&:focus': { outline: 'none' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}>{t.cursorReset}</Alert>;
}

/** Aba Por cliente (COST-14): lista paginada no servidor, nome sob a flag `costs.tenantName`. */
export default function TenantsTab() {
  const [filters, setFilters] = usePersistedState<CostFilters>('costs.filters', DEFAULT_COST_FILTERS, { scope: 'tab' });
  const q = useCostTenants(filters.month, filters.plan);
  const filtersBar = <CostFiltersBar filters={filters} onChange={setFilters} aria={t.filtersAria} showBasis={false} />;

  let body;
  if (q.monthUnavailable && !q.loading) {
    body = (
      <Alert
        severity="info"
        action={(
          <Button color="inherit" size="small" sx={{ whiteSpace: 'nowrap' }} onClick={() => setFilters({ ...filters, month: null })}>
            {S.summary.backToCurrentMonth}
          </Button>
        )}
      >
        {S.summary.monthEmpty(monthLabel(filters.month ?? ''))}
      </Alert>
    );
  } else if (q.unavailable && !q.meta) {
    body = <ServiceUpdatingState onRetry={q.reload} />;
  } else if (q.loading) {
    body = (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress aria-label={t.loading} />
      </Box>
    );
  } else if (q.error || !q.meta) {
    body = (
      <Alert severity={q.slow ? 'warning' : 'error'} action={<Button color="inherit" size="small" sx={{ whiteSpace: 'nowrap' }} onClick={() => void q.reload()}>{S.retry}</Button>}>
        {q.slow ? S.errors.readSlow : q.error ?? S.errors.loadFailed}
      </Alert>
    );
  } else {
    const meta = q.meta;
    const empty = q.rows.length === 0;
    const emptyText = meta.basis === 'snapshot' ? t.emptySnapshot : filters.plan === 'all' ? t.empty : t.emptyPlan;
    body = (
      <>
        <StatusBand page={meta} />
        {q.cursorReset && <CursorResetNotice />}
        <SectionCard title={t.title} subtitle={t.subtitle(monthLabel(meta.month))} noPadding={!empty}>
          {empty ? <Typography variant="body2" color="text.secondary">{emptyText}</Typography> : <TenantsTable q={q} />}
        </SectionCard>
      </>
    );
  }

  return (
    <Stack spacing={2}>
      {filtersBar}
      {body}
    </Stack>
  );
}
