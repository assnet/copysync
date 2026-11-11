import { lazy, Suspense, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, CircularProgress, Grid, IconButton, LinearProgress, Skeleton, Stack, Tab, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { Cable, Hourglass, Info, Server } from 'lucide-react';
import { AppIcon, EmptyState, PageHeader, SectionCard, StatCard } from '@/components';
import { serverNow } from '@/services/serverClock';
import { formatRelativeTime } from '@/features/linkDomainsAdmin/rules';
import { occupancyLevel, occupancyPercent, sortWorkers, type OccupancyLevel } from '@/features/workersAdmin/rules';
import { workersAdminStrings as t } from '@/features/workersAdmin/strings';
import { useAdminWorkers } from '@/features/workersAdmin/useAdminWorkers';
import type { LeaseProcess, WorkerOccupancy, WorkerOccupancyList } from '@/features/workersAdmin/types';
import { opsMetricsStrings } from '@/features/opsMetrics/strings';

/** Aba Consumo em chunk próprio: a biblioteca de gráficos só baixa ao abrir a aba. */
const UsageTab = lazy(() => import('@/features/opsMetrics/components/UsageTab'));

/** Aba Configuração em chunk próprio (formulário e diálogo só baixam ao abrir a aba). */
const SettingsTab = lazy(() => import('@/features/workersAdmin/components/SettingsTab'));

/** Aba Capacidade em chunk próprio (cartões, tabela por plano e série de 7 dias). */
const CapacityTab = lazy(() => import('@/features/workersAdmin/components/CapacityTab'));

export const WORKERS_PATH = '/admin/workers';
export const WORKERS_USAGE_PATH = '/admin/workers/usage';
export const WORKERS_CAPACITY_PATH = '/admin/workers/capacity';
export const WORKERS_SETTINGS_PATH = '/admin/workers/settings';

/** Abas pela URL: caminho → rótulo. A ativa é a de prefixo mais longo que casa com o caminho. */
const WORKER_TABS: { path: string; label: string }[] = [
  { path: WORKERS_PATH, label: t.tabs.occupancy },
  { path: WORKERS_USAGE_PATH, label: t.tabs.usage },
  { path: WORKERS_CAPACITY_PATH, label: t.tabs.capacity },
  { path: WORKERS_SETTINGS_PATH, label: t.tabs.settings },
];

/** Subtítulo do cabeçalho por aba; ausente = o da aba Ocupação. */
const TAB_SUBTITLES: Record<string, string> = {
  [WORKERS_USAGE_PATH]: opsMetricsStrings.subtitle,
  [WORKERS_CAPACITY_PATH]: t.capacity.subtitle,
  [WORKERS_SETTINGS_PATH]: t.settings.subtitle,
};

export function activeWorkersTab(pathname: string): string {
  const match = WORKER_TABS
    .filter((tab) => pathname === tab.path || pathname.startsWith(`${tab.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return match?.path ?? WORKERS_PATH;
}

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

function LeaseProcessesTable({ processes }: { processes: LeaseProcess[] }) {
  const sorted = [...processes].sort((a, b) => b.sessions - a.sessions || a.workerId.localeCompare(b.workerId));
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t.lease.columns.process}</TableCell>
            <TableCell align="right">{t.lease.columns.sessions}</TableCell>
            <TableCell>
              <Tooltip title={t.lease.leaseUntilHint}>
                <span>{t.lease.columns.leaseUntil}</span>
              </Tooltip>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((p) => (
            <TableRow key={p.workerId}>
              <TableCell sx={{ fontFamily: 'monospace', wordBreak: 'break-all', minWidth: 120 }}>{p.workerId}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{p.sessions}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                <time dateTime={p.leaseUntil}>{new Date(p.leaseUntil).toLocaleTimeString('pt-BR')}</time>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** Adoção desligada: sem heartbeat; os processos vêm dos leases vivos e não há teto. */
function LeaseView({ data }: { data: WorkerOccupancyList }) {
  const processes = data.processes ?? [];
  return (
    <>
      <Alert
        severity="info"
        sx={{ mb: 2, alignItems: 'center' }}
        action={(
          <Tooltip title={t.lease.noticeHint}>
            <IconButton size="small" color="inherit" aria-label={t.lease.noticeHintAria}>
              <AppIcon icon={Info} size="sm" />
            </IconButton>
          </Tooltip>
        )}
      >
        {t.lease.notice}
      </Alert>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={6}>
          <StatCard label={t.lease.processes} value={processes.length} icon={<AppIcon icon={Server} size="md" />} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <Tooltip title={t.lease.sessionsHint} placement="bottom-start">
            <Box>
              <StatCard
                label={t.lease.sessions}
                value={t.lease.sessionsNoCap(data.leasedSessions ?? 0)}
                icon={<AppIcon icon={Cable} size="md" />}
              />
            </Box>
          </Tooltip>
        </Grid>
      </Grid>
      <SectionCard title={t.lease.listTitle} noPadding={processes.length > 0}>
        {processes.length === 0 ? (
          <EmptyState icon={<AppIcon icon={Server} size="lg" />} title={t.lease.empty} description={t.lease.emptyHint} sx={{ py: 5 }} />
        ) : (
          <LeaseProcessesTable processes={processes} />
        )}
      </SectionCard>
    </>
  );
}

/** Adoção ligada: ocupação pelos batimentos dos workers (com teto). */
function WorkersView({ data }: { data: WorkerOccupancyList }) {
  return (
    <>
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
  );
}

/** Aba Ocupação: conteúdo original da tela (atualiza a cada 20 s). */
function OccupancyTab() {
  const w = useAdminWorkers();
  const data = w.data;

  if (w.loading && !data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress aria-label={t.pageTitle} />
      </Box>
    );
  }
  if (w.loadError || !data) {
    return (
      <Alert
        severity="error"
        action={<Button color="inherit" size="small" onClick={() => void w.reload()}>{t.retry}</Button>}
      >
        {w.loadError ?? t.errors.generic}
      </Alert>
    );
  }
  return (
    <>
      {w.refreshError && <Alert severity="warning" sx={{ mb: 2 }}>{t.refreshFailed}</Alert>}
      {data.adoptionEnabled === false ? <LeaseView data={data} /> : <WorkersView data={data} />}
    </>
  );
}

export function AdminWorkersPage() {
  const { pathname } = useLocation();
  const active = activeWorkersTab(pathname);
  const usage = active === WORKERS_USAGE_PATH;
  // Celular: setas sempre montadas desde o 1º render. Com `auto` elas surgem depois da medição,
  // empurram as abas e a ativa fica cortada sem nova rolagem (`noSsr` = valor certo já no 1º render).
  const theme = useTheme();
  const compactTabs = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  // Ações do cabeçalho da aba Consumo entram aqui por portal (a aba é carregada sob demanda).
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const subtitle = TAB_SUBTITLES[active] ?? t.pageSubtitle;

  return (
    <Box>
      <PageHeader
        title={t.pageTitle}
        subtitle={subtitle}
        action={usage ? <Box ref={setHeaderSlot} /> : undefined}
        sx={{ mb: 2 }}
      />
      <Tabs
        value={active}
        aria-label={t.tabs.aria}
        variant="scrollable"
        scrollButtons={compactTabs ? true : 'auto'}
        allowScrollButtonsMobile
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        {WORKER_TABS.map((tab) => (
          <Tab key={tab.path} label={tab.label} value={tab.path} component={Link} to={tab.path} />
        ))}
      </Tabs>

      {usage && (
        <Suspense fallback={<Skeleton variant="rounded" height={320} aria-label={opsMetricsStrings.loading} />}>
          <UsageTab headerSlot={headerSlot} />
        </Suspense>
      )}
      {active === WORKERS_CAPACITY_PATH && (
        <Suspense fallback={<Skeleton variant="rounded" height={320} aria-label={t.capacity.loading} />}>
          <CapacityTab />
        </Suspense>
      )}
      {active === WORKERS_SETTINGS_PATH && (
        <Suspense fallback={<Skeleton variant="rounded" height={320} aria-label={t.settings.loading} />}>
          <SettingsTab />
        </Suspense>
      )}
      {active === WORKERS_PATH && <OccupancyTab />}
    </Box>
  );
}
