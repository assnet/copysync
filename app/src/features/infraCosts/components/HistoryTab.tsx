import { lazy, Suspense, useId } from 'react';
import { Alert, Box, Button, CircularProgress, Skeleton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { SectionCard, ServiceUpdatingState } from '@/components';
import { planName } from '@/features/planEntitlementsAdmin/strings';
import { formatDateTime } from '@/features/opsMetrics/rules';
import { historyPlanKeys, historyPlanTotal, monthLabel } from '../rules';
import { infraCostsStrings as S } from '../strings';
import type { InfraCostHistoryMonthView } from '../types';
import { useCostHistory } from '../useCostHistory';
import { HeaderHint, HintChip, Money, StickyFirstColumn } from './costParts';

/** Gráfico em chunk próprio: a tabela aparece sem esperar o x-charts. */
const HistoryChart = lazy(() => import('./HistoryChart'));

const h = S.history;
const rateText = (rate: number) => `R$ ${rate.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;

function HistoryTable({ months, id }: { months: InfraCostHistoryMonthView[]; id: string }) {
  const keys = historyPlanKeys(months);
  // Σ planos + não rateado + fora do rateio = total. "Não rateado" só aparece quando algum mês tem valor.
  const showUnallocated = months.some((m) => (m.unallocated?.usd ?? 0) !== 0);
  const col = h.columns;
  return (
    <StickyFirstColumn>
      <Table size="small" aria-label={h.tableAria} id={id}>
        <TableHead>
          <TableRow>
            <TableCell>{col.month}</TableCell>
            {keys.map((k) => <TableCell key={k ?? '__none'} align="right" sx={{ whiteSpace: 'nowrap' }}>{k ? planName(k) : S.summary.plans.noPlan}</TableCell>)}
            {showUnallocated && <TableCell align="right"><HeaderHint label={col.unallocated} hint={col.unallocatedHint} /></TableCell>}
            <TableCell align="right"><HeaderHint label={col.excluded} hint={col.excludedHint} /></TableCell>
            <TableCell align="right">{col.total}</TableCell>
            <TableCell align="right">{col.fx}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {months.map((m) => (
            <TableRow key={m.month}>
              <TableCell sx={{ minWidth: 120 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{monthLabel(m.month)}</Typography>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5, mt: 0.25 }}>
                  <HintChip label={h.frozen} hint={`${h.frozenHint} ${h.closedAt(formatDateTime(m.closedAt))}.`} color="success" />
                  {m.totalIsPartial && <HintChip label={h.partial} hint={h.partialHint} color="warning" />}
                </Stack>
              </TableCell>
              {keys.map((k) => <TableCell key={k ?? '__none'} align="right"><Money layout="table" value={historyPlanTotal(m, k)} /></TableCell>)}
              {showUnallocated && <TableCell align="right"><Money layout="table" value={m.unallocated ?? null} /></TableCell>}
              <TableCell align="right"><Money layout="table" value={m.excluded ?? null} /></TableCell>
              <TableCell align="right"><Money layout="table" value={m.total} strong /></TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                {m.fx ? (
                  <>
                    <Typography variant="body2" component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>{rateText(m.fx.rate)}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {`${S.fxSource[m.fx.source]}, ${S.closingMethod[m.closingMethod]}`}
                    </Typography>
                  </>
                ) : (
                  <Typography variant="body2" component="span" color="text.secondary">{h.noFx}</Typography>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </StickyFirstColumn>
  );
}

/** Aba Histórico (COST-15): meses fechados, barras por plano e a tabela com os mesmos números. */
export default function HistoryTab() {
  const q = useCostHistory();
  const tableId = useId();
  if (q.unavailable && !q.data) return <ServiceUpdatingState onRetry={q.reload} />;
  if (q.loading && !q.data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress aria-label={h.loading} />
      </Box>
    );
  }
  if (q.error || !q.data) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" sx={{ whiteSpace: 'nowrap' }} onClick={() => void q.reload()}>{S.retry}</Button>}>
        {q.error ?? S.errors.loadFailed}
      </Alert>
    );
  }
  const { months } = q.data;
  if (months.length === 0) {
    return (
      <SectionCard title={h.title} subtitle={h.subtitle}>
        <Typography variant="body2" color="text.secondary">{h.empty}</Typography>
      </SectionCard>
    );
  }
  return (
    <Stack spacing={2}>
      <SectionCard title={h.chartTitle} subtitle={h.chartSubtitle}>
        <Suspense fallback={<Skeleton variant="rounded" height={240} role="status" aria-label={h.chartLoading} />}>
          <HistoryChart months={months} tableId={tableId} />
        </Suspense>
      </SectionCard>
      <SectionCard title={h.title} subtitle={h.subtitle} noPadding>
        <HistoryTable months={months} id={tableId} />
      </SectionCard>
    </Stack>
  );
}
