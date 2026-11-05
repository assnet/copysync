import {
  Alert, Box, Button, Card, CardContent, CircularProgress, Grid, LinearProgress, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import { Hourglass, Server } from 'lucide-react';
import { AppIcon, EmptyState, PageHeader, SectionCard, StatCard } from '@/components';
import { serverNow } from '@/services/serverClock';
import { formatRelativeTime } from '@/features/linkDomainsAdmin/rules';
import { occupancyLevel, occupancyPercent, sortWorkers, type OccupancyLevel } from '@/features/workersAdmin/rules';
import { workersAdminStrings as t } from '@/features/workersAdmin/strings';
import { useAdminWorkers } from '@/features/workersAdmin/useAdminWorkers';
import type { WorkerOccupancy } from '@/features/workersAdmin/types';

const LEVEL_COLOR: Record<OccupancyLevel, 'success' | 'warning' | 'error'> = {
  ok: 'success', warning: 'warning', full: 'error',
};

function OccupancyCell({ worker }: { worker: WorkerOccupancy }) {
  const pct = occupancyPercent(worker.sessions, worker.maxSessions);
  return (
    <Stack spacing={0.5} sx={{ minWidth: 140 }}>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {t.sessionsOf(worker.sessions, worker.maxSessions)}
      </Typography>
      <LinearProgress
        variant="determinate"
        value={pct}
        color={LEVEL_COLOR[occupancyLevel(worker.sessions, worker.maxSessions)]}
        aria-label={t.occupancyAria(worker.workerId, pct)}
        sx={{ height: 6, borderRadius: 3 }}
      />
    </Stack>
  );
}

function WorkersTable({ workers }: { workers: WorkerOccupancy[] }) {
  const now = serverNow();
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t.columns.worker}</TableCell>
            <TableCell>{t.columns.role}</TableCell>
            <TableCell>{t.columns.sessions}</TableCell>
            <TableCell align="right">
              <Tooltip title={t.pendingLoginsHint}>
                <span>{t.columns.pendingLogins}</span>
              </Tooltip>
            </TableCell>
            <TableCell align="right">{t.columns.memory}</TableCell>
            <TableCell>{t.columns.seen}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sortWorkers(workers).map((w) => (
            <TableRow key={w.workerId}>
              <TableCell sx={{ fontFamily: 'monospace', wordBreak: 'break-all', minWidth: 120 }}>{w.workerId}</TableCell>
              <TableCell>{t.roles[w.role] ?? w.role}</TableCell>
              <TableCell><OccupancyCell worker={w} /></TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{w.pendingLogins ?? 0}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{t.memoryMb(w.rssMb)}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                <Tooltip title={new Date(w.seenAt).toLocaleString('pt-BR')}>
                  <time dateTime={w.seenAt}>{formatRelativeTime(w.seenAt, now, t.justNow)}</time>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function AwaitingCard({ awaiting }: { awaiting: number }) {
  const waiting = awaiting > 0;
  return (
    <Card sx={{ mt: 2, borderLeft: 4, borderColor: waiting ? 'warning.main' : 'divider' }}>
      <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <Box sx={{ color: waiting ? 'warning.main' : 'text.secondary', display: 'flex' }}>
          <AppIcon icon={Hourglass} size="lg" aria-hidden />
        </Box>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {t.awaiting.title}
            <Box component="span" sx={{ ml: 1, fontVariantNumeric: 'tabular-nums' }}>{awaiting}</Box>
          </Typography>
          <Typography variant="body2" color="text.secondary" role="status">
            {waiting ? t.awaiting.some(awaiting) : t.awaiting.none}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

export function AdminWorkersPage() {
  const w = useAdminWorkers();
  const data = w.data;

  return (
    <Box>
      <PageHeader title={t.pageTitle} subtitle={t.pageSubtitle} />

      {w.loading && !data ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label={t.pageTitle} />
        </Box>
      ) : w.loadError || !data ? (
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={() => void w.reload()}>{t.retry}</Button>}
        >
          {w.loadError ?? t.errors.generic}
        </Alert>
      ) : (
        <>
          {w.refreshError && <Alert severity="warning" sx={{ mb: 2 }}>{t.refreshFailed}</Alert>}
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={6}>
              <StatCard label={t.totals.workers} value={data.totals.workers} icon={<AppIcon icon={Server} size="md" />} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <StatCard
                label={t.totals.sessions}
                value={t.totals.capacity(
                  data.totals.sessions,
                  data.totals.maxSessions,
                  occupancyPercent(data.totals.sessions, data.totals.maxSessions),
                )}
              />
            </Grid>
          </Grid>

          <SectionCard title={t.listTitle} noPadding={data.workers.length > 0}>
            {data.workers.length === 0 ? (
              <EmptyState icon={<AppIcon icon={Server} size="lg" />} title={t.empty} description={t.emptyHint} sx={{ py: 5 }} />
            ) : (
              <WorkersTable workers={data.workers} />
            )}
          </SectionCard>

          <AwaitingCard awaiting={data.awaiting} />
        </>
      )}
    </Box>
  );
}
