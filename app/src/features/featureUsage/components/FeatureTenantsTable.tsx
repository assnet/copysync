import {
  Alert, Box, Button, Chip, CircularProgress, IconButton, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Tooltip, Typography,
} from '@mui/material';
import { Filter } from 'lucide-react';
import { AppIcon, SectionCard } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { CursorResetNotice } from '@/features/infraCosts/components/CursorResetNotice';
import { formatDay, formatInteger, planLabel } from '../rules';
import { featureUsageStrings as S } from '../strings';
import type { UsageTenantItem } from '../types';
import type { UsageTenantsState } from '../hooks/useUsageTenants';
import { UsageRetryAlert } from './UsageSummaryGate';

const t = S.tenants;
const col = t.columns;
const numCell = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;

function TenantRow({ row, blur, filtered, onFilter }: {
  row: UsageTenantItem; blur: boolean; filtered: boolean; onFilter: (tenantId: string) => void;
}) {
  return (
    <TableRow selected={filtered}>
      <TableCell sx={{ fontWeight: 600, minWidth: 120, maxWidth: { xs: 160, sm: 280 }, overflowWrap: 'anywhere' }}>
        <Blurred when={blur} inline radius={5}>{row.tenantName}</Blurred>
        {row.internal && (
          <Tooltip title={t.internalHint} enterTouchDelay={0}>
            <Chip size="small" variant="outlined" label={t.internal} sx={{ ml: 1 }} />
          </Tooltip>
        )}
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{planLabel(row.plan)}</TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{S.statuses[row.status] ?? row.status}</TableCell>
      <TableCell align="right" sx={numCell}>{formatInteger(row.uses)}</TableCell>
      <TableCell align="right" sx={numCell}>{formatInteger(row.activeDays)}</TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.lastUsedDay ? formatDay(row.lastUsedDay, true) : S.measures.never}</TableCell>
      <TableCell align="right">
        <Tooltip title={S.actions.filterByAccount}>
          <span>
            <IconButton
              // O nome não entra no rótulo acessível quando está borrado (leitor de tela não pode furar a privacidade).
              aria-label={S.actions.filterByAccountAria(blur ? S.filters.accountShort(row.tenantId) : row.tenantName)}
              onClick={() => onFilter(row.tenantId)}
              disabled={filtered}
              sx={{ width: 44, height: 44 }}
            >
              <AppIcon icon={Filter} size="sm" aria-hidden />
            </IconButton>
          </span>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}

/**
 * Contas que mais usam o recurso (ordem por usos, da API). Nome sob a flag `usage.tenantName`; "filtrar por esta
 * conta" grava só o `tenantId` nos filtros. "Carregar mais" segue o `nextCursor`; cursor inválido recarrega do
 * início com aviso (que recebe o foco).
 */
export function FeatureTenantsTable({ q, filteredTenantId, onFilter }: {
  q: UsageTenantsState;
  filteredTenantId: string | null;
  onFilter: (tenantId: string) => void;
}) {
  const blur = useBlur('usage.tenantName');
  let body;
  if (q.loading) {
    body = (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress aria-label={t.loading} />
      </Box>
    );
  } else if (q.error || q.slow) {
    body = <Box sx={{ p: 2 }}><UsageRetryAlert slow={q.slow} onRetry={q.reload} /></Box>;
  } else if (q.rows.length === 0) {
    body = <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>{t.empty}</Typography>;
  } else {
    body = (
      <>
        <TableContainer>
          <Table size="small" aria-label={t.aria}>
            <TableHead>
              <TableRow>
                <TableCell>{col.account}</TableCell>
                <TableCell>{col.plan}</TableCell>
                <TableCell>{col.status}</TableCell>
                <TableCell align="right">{col.uses}</TableCell>
                <TableCell align="right">{col.activeDays}</TableCell>
                <TableCell>{col.lastUsed}</TableCell>
                <TableCell align="right">{col.actions}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {q.rows.map((row) => (
                <TenantRow key={row.tenantId} row={row} blur={blur} filtered={row.tenantId === filteredTenantId} onFilter={onFilter} />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {(q.hasMore || q.moreError) && (
          <Stack spacing={1} sx={{ px: 2, py: 1.5 }}>
            {q.hasMore && (
              <div>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={q.loadMore}
                  disabled={q.loadingMore}
                  startIcon={q.loadingMore ? <CircularProgress size={14} aria-label={t.loadingMore} /> : undefined}
                  sx={{ minHeight: 44 }}
                >
                  {S.actions.loadMore}
                </Button>
              </div>
            )}
            {q.moreError && (
              <Alert severity="error" action={<Button color="inherit" size="small" sx={{ whiteSpace: 'nowrap' }} onClick={q.loadMore}>{S.actions.retry}</Button>}>
                {t.moreFailed}
              </Alert>
            )}
          </Stack>
        )}
      </>
    );
  }

  return (
    <Stack spacing={2}>
      {q.cursorReset && !q.loading && <CursorResetNotice message={t.cursorReset} />}
      <SectionCard title={t.title} subtitle={t.subtitle} noPadding>
        {body}
      </SectionCard>
    </Stack>
  );
}
