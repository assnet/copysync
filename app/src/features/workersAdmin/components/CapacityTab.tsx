import { useMemo, type ReactNode } from 'react';
import {
  Alert, Box, Button, Card, CardContent, CircularProgress, Grid, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Tooltip, Typography, useTheme,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { LucideIcon } from 'lucide-react';
import { Gauge, HardDrive, Layers, MemoryStick, PlugZap, Server, SlidersHorizontal } from 'lucide-react';
import { AppIcon, SectionCard, ServiceUpdatingState } from '@/components';
import { HelpTip } from '@/features/opsMetrics/components/HelpTip';
import { MetricChartCard, type ChartTable } from '@/features/opsMetrics/components/MetricChartCard';
import { TimeLineChart, type LineSpec } from '@/features/opsMetrics/components/TimeLineChart';
import { chartColors } from '@/features/opsMetrics/chartColors';
import { alignSeries, countDomainMax, formatDateTime, formatNumber, seriesPoints } from '@/features/opsMetrics/rules';
import { planName } from '@/features/planEntitlementsAdmin/strings';
import { serverNow } from '@/services/serverClock';
import { avgContractedPerTenant, clientsThatFit, isUnlimitedPlan, sortPlansByCatalog } from '../rules';
import { workersAdminStrings } from '../strings';
import type { WorkerCapacityChannel, WorkerCapacityPlan } from '../types';
import { useWorkerCapacity } from '../useWorkerCapacity';

const c = workersAdminStrings.capacity;
const num = (n: number) => n.toLocaleString('pt-BR');

interface TileProps {
  label: string;
  help: string;
  icon: LucideIcon;
  /** `null` = sem amostra (nunca 0 inventado). */
  value: string | null;
  context?: string | null;
}

const TILE_LABEL_LINE_HEIGHT = 1.3;
/** Ícone e ajuda centrados na 1ª linha do rótulo: altura de uma linha do caption, sem offset fixo. */
const TILE_LINE_SLOT: SxProps<Theme> = {
  flexShrink: 0, display: 'flex', alignItems: 'center',
  height: (theme) => `calc(${theme.typography.caption.fontSize} * ${TILE_LABEL_LINE_HEIGHT})`,
};

/** Cartão do cluster: rótulo com ajuda, valor e contexto. Sem valor mostra "sem amostra". */
function CapacityTile({ label, help, icon, value, context }: TileProps) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'flex-start', color: 'text.secondary' }}>
          <Box sx={TILE_LINE_SLOT}><AppIcon icon={icon} size="inline" aria-hidden /></Box>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, flex: 1, minWidth: 0, lineHeight: TILE_LABEL_LINE_HEIGHT,
              overflowWrap: 'anywhere',
            }}
          >
            {label}
          </Typography>
          <Box sx={TILE_LINE_SLOT}><HelpTip label={label} text={help} /></Box>
        </Stack>
        <Typography
          variant={value === null ? 'body1' : 'h5'}
          component="p"
          sx={{
            mt: 1, fontWeight: value === null ? 500 : 700, fontVariantNumeric: 'tabular-nums',
            color: value === null ? 'text.secondary' : 'text.primary',
          }}
        >
          {value ?? c.noSample}
        </Typography>
        {context && <Typography variant="caption" color="text.secondary">{context}</Typography>}
      </CardContent>
    </Card>
  );
}

function HeaderWithHint({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip title={hint} arrow>
      <Box component="span" tabIndex={0} sx={{ borderBottom: 1, borderBottomStyle: 'dotted', borderBottomColor: 'text.disabled', cursor: 'help' }}>
        {label}
      </Box>
    </Tooltip>
  );
}

function ContractedCell({ ch }: { ch: WorkerCapacityChannel }) {
  return (
    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {num(ch.contracted)}
      {ch.unlimitedTenants > 0 && (
        <Typography variant="caption" color="text.secondary" component="span" sx={{ display: 'block' }}>
          {c.plans.unlimited(ch.unlimitedTenants)}
        </Typography>
      )}
    </TableCell>
  );
}

/** Motivo do "—" na projeção (Tooltip). */
function fitReason(plan: WorkerCapacityPlan, headroom: number | null): string {
  if (plan.tenants <= 0) return c.plans.fitNoTenants;
  if (isUnlimitedPlan(plan)) return c.plans.fitUnlimited;
  if (headroom === null) return c.plans.fitNoSample;
  const avg = avgContractedPerTenant(plan);
  return avg !== null && avg <= 0 ? c.plans.fitNoContracted : c.plans.fitNoSample;
}

function FitCell({ plan, headroom }: { plan: WorkerCapacityPlan; headroom: number | null }) {
  const n = clientsThatFit(plan, headroom);
  if (n !== null) {
    return <TableCell align="right" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{c.plans.fit(n)}</TableCell>;
  }
  const reason = fitReason(plan, headroom);
  return (
    <TableCell align="right">
      <Tooltip title={reason} arrow>
        <Box component="span" tabIndex={0} aria-label={reason} sx={{ color: 'text.secondary', cursor: 'help' }}>—</Box>
      </Tooltip>
    </TableCell>
  );
}

function PlansTable({ plans, headroom }: { plans: WorkerCapacityPlan[]; headroom: number | null }) {
  const col = c.plans.columns;
  const visible = sortPlansByCatalog(plans).filter((p) => p.tenants > 0 || p.planSlug !== null);
  if (visible.length === 0) {
    return <Typography variant="body2" color="text.secondary">{c.plans.empty}</Typography>;
  }
  const sub = { color: 'text.secondary', fontSize: 12, whiteSpace: 'nowrap' } as const;
  return (
    <TableContainer>
      <Table size="small" aria-label={c.plans.aria}>
        <TableHead>
          <TableRow>
            <TableCell rowSpan={2}>{col.plan}</TableCell>
            <TableCell rowSpan={2} align="right">{col.tenants}</TableCell>
            <TableCell colSpan={2} align="center">{col.whatsapp}</TableCell>
            <TableCell colSpan={2} align="center">{col.telegram}</TableCell>
            <TableCell rowSpan={2} align="right"><HeaderWithHint label={col.fit} hint={c.plans.fitHint} /></TableCell>
          </TableRow>
          <TableRow>
            {[0, 1].map((i) => [
              <TableCell key={`c${i}`} align="right" sx={sub}><HeaderWithHint label={col.contracted} hint={c.plans.contractedHint} /></TableCell>,
              <TableCell key={`n${i}`} align="right" sx={sub}><HeaderWithHint label={col.connected} hint={c.plans.connectedHint} /></TableCell>,
            ])}
          </TableRow>
        </TableHead>
        <TableBody>
          {visible.map((p) => (
            <TableRow key={p.planSlug ?? '__none'}>
              <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{p.planSlug ? planName(p.planSlug) : c.plans.noPlan}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(p.tenants)}</TableCell>
              <ContractedCell ch={p.whatsapp} />
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(p.whatsapp.connected)}</TableCell>
              <ContractedCell ch={p.telegram} />
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(p.telegram.connected)}</TableCell>
              <FitCell plan={p} headroom={headroom} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function CapacitySeries({ w }: { w: ReturnType<typeof useWorkerCapacity> }) {
  const theme = useTheme();
  const colors = chartColors(theme.palette.mode);
  const chart = useMemo(() => {
    const list = w.series?.series ?? [];
    const aligned = alignSeries(
      [seriesPoints(list, 'sessions_connected'), seriesPoints(list, 'sessions_capacity')],
      w.series?.bucketMinutes ?? 60,
    );
    const avg = (rows: (typeof aligned.rows)[number]) => rows.map((p) => (p ? p.avg : null));
    const fmt = (v: number) => formatNumber(v, 0);
    const lines: LineSpec[] = [
      { id: 'connected', label: c.series.connected, color: colors.ordered[0], values: avg(aligned.rows[0]), format: fmt },
      { id: 'capacity', label: c.series.capacity, color: colors.ordered[1], values: avg(aligned.rows[1]), format: fmt },
    ];
    const table: ChartTable = {
      headers: [c.series.time, c.series.connected, c.series.capacity],
      rows: aligned.times
        .map((ms, i) => [formatDateTime(ms), ...aligned.rows.map((r) => (r[i] ? fmt(r[i]!.avg) : '—'))])
        .reverse(),
    };
    const yMax = countDomainMax([...lines[0].values, ...lines[1].values]);
    return { times: aligned.times, lines, table, yMax };
  }, [w.series, colors.ordered]);

  return (
    <MetricChartCard
      title={c.series.title}
      unit={c.series.unit}
      help={c.series.help}
      loading={w.seriesLoading && !w.series}
      error={w.seriesError}
      onRetry={() => void w.reloadSeries()}
      empty={chart.times.length === 0}
      emptyText={c.series.empty}
      figureAria={c.series.figureAria}
      table={chart.table}
    >
      <TimeLineChart times={chart.times} range="7d" lines={chart.lines} yMin={0} yMax={chart.yMax} />
    </MetricChartCard>
  );
}

/** Aba Capacidade (WSCALE-10): cartões do cluster, tabela por plano com projeção e série de 7 dias. */
export default function CapacityTab() {
  const w = useWorkerCapacity();
  const { data } = w;

  // API fora do ar (deploy): estado de atualização; a nova tentativa relê cartões e série.
  if (w.unavailable && !data) {
    return <ServiceUpdatingState onRetry={() => Promise.all([w.reload(), w.reloadSeries()])} />;
  }
  if (w.loading && !data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress aria-label={c.loading} />
      </Box>
    );
  }

  let cluster: ReactNode;
  let plans: ReactNode;
  if (w.error || !data) {
    const alert = (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void w.reload()}>{workersAdminStrings.retry}</Button>}>
        {w.error ?? c.errors.loadFailed}
      </Alert>
    );
    cluster = alert;
    plans = null;
  } else {
    const k = data.cluster;
    const sampled = k.sampledAt !== null;
    const v = (n: number, f: (x: number) => string = num) => (sampled ? f(n) : null);
    const cards = c.cards;
    const ratioPct = `${formatNumber(data.settings.alertOccupancyRatio * 100, 0)}%`;
    const tiles: TileProps[] = [
      {
        label: cards.capacity.label, help: data.enforced ? cards.capacity.help : cards.capacity.helpNotEnforced,
        icon: Server, value: v(k.capacity, c.sessions),
      },
      { ...cards.connected, icon: PlugZap, value: v(k.connected, c.sessions) },
      { ...cards.occupancy, icon: Gauge, value: v(k.occupancyPct, (x) => `${formatNumber(x, 1)}%`), context: cards.occupancy.alertAt(ratioPct) },
      { ...cards.headroom, icon: Layers, value: v(k.headroom, c.sessions) },
      { ...cards.replicas, icon: HardDrive, value: v(k.requiredReplicas, c.workers) },
      {
        ...cards.mbPerSession, icon: MemoryStick,
        value: k.mbPerSession === null ? null : c.mb(formatNumber(k.mbPerSession, 1)),
        context: k.memoryLimitMb === null ? null : c.perWorkerLimit(formatNumber(k.memoryLimitMb, 0)),
      },
      {
        ...cards.suggested, icon: SlidersHorizontal,
        value: k.suggestedMaxSessions === null ? null : c.sessions(k.suggestedMaxSessions),
        context: cards.suggested.current(data.settings.maxSessionsPerWorker),
      },
    ];
    cluster = (
      <Stack spacing={2}>
        {!data.enforced && <Alert severity="info">{c.notEnforced}</Alert>}
        {!sampled && <Alert severity="info">{c.noSampleNotice}</Alert>}
        {sampled && k.stale === true && (
          <Alert severity="warning">{c.stale(Math.max(0, Math.floor((serverNow() - Date.parse(k.sampledAt!)) / 60_000)))}</Alert>
        )}
        <SectionCard
          title={c.clusterTitle}
          subtitle={sampled ? c.clusterSubtitleAt(formatDateTime(k.sampledAt!)) : c.clusterSubtitle}
        >
          <Grid container spacing={2}>
            {tiles.map((tile) => (
              <Grid item xs={6} sm={4} lg={3} key={tile.label}><CapacityTile {...tile} /></Grid>
            ))}
          </Grid>
        </SectionCard>
      </Stack>
    );
    plans = (
      <SectionCard title={c.plans.title} subtitle={c.plans.subtitle}>
        <PlansTable plans={data.plans} headroom={sampled ? k.headroom : null} />
      </SectionCard>
    );
  }

  return (
    <Stack spacing={2}>
      {cluster}
      {plans}
      <CapacitySeries w={w} />
    </Stack>
  );
}
