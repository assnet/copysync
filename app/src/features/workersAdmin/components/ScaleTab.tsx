import { useState, type ReactNode } from 'react';
import {
  Alert, AlertTitle, Box, Button, Card, CardContent, Chip, CircularProgress, Grid, Skeleton, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import { ArrowDown, ArrowRight, ArrowUp, Gauge, Layers, Server, SlidersHorizontal, Target } from 'lucide-react';
import { AppIcon, SectionCard } from '@/components';
import { CooldownBar } from '@/components/CooldownBar';
import { HelpTip } from '@/features/opsMetrics/components/HelpTip';
import { formatDateTime } from '@/features/opsMetrics/rules';
import { serverNow } from '@/services/serverClock';
import { cooldownActive, defaultScaleTarget, formatScaleRemaining, scaleBlock, scaleStepAllowed, type ScaleBlock } from '../rules';
import { workersAdminStrings } from '../strings';
import type { WorkerScaleEvent, WorkerScaleOutcome, WorkerScaleStateView } from '../types';
import { useWorkerScale } from '../useWorkerScale';
import { ScaleConfirmDialog } from './ScaleConfirmDialog';

const sc = workersAdminStrings.scale;

function Tile({ label, help, icon, value }: { label: string; help: string; icon: LucideIcon; value: string | null }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', color: 'text.secondary' }}>
          <AppIcon icon={icon} size="inline" aria-hidden />
          <Typography
            variant="caption"
            sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}
          >
            {label}
          </Typography>
          <HelpTip label={label} text={help} />
        </Stack>
        <Typography
          variant={value === null ? 'body1' : 'h5'}
          component="p"
          sx={{
            mt: 1, fontWeight: value === null ? 500 : 700, fontVariantNumeric: 'tabular-nums',
            color: value === null ? 'text.secondary' : 'text.primary',
          }}
        >
          {value ?? sc.tiles.noValue}
        </Typography>
      </CardContent>
    </Card>
  );
}

const BLOCK_TEXT: Record<Exclude<ScaleBlock, 'notReady'>, string> = {
  modeOff: sc.blocked.modeOff,
  notEnforced: sc.blocked.notEnforced,
  disk: sc.blocked.disk,
  nativeAutoscaling: sc.blocked.nativeAutoscaling,
};

/** Aviso do escalador: o que falta configurar, provedor fora ou por que os pedidos estão desligados. */
function ScalerNotice({ view, block }: { view: WorkerScaleStateView; block: ScaleBlock | null }) {
  const notices: ReactNode[] = [];
  if (view.scaler.status === 'not_configured') {
    notices.push(
      <Alert key="nc" severity="info">
        <AlertTitle>{sc.notConfigured.title}</AlertTitle>
        <Typography variant="body2" sx={{ mb: 1 }}>{sc.notConfigured.intro}</Typography>
        <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>{sc.notConfigured.missingLabel}</Typography>
        <Stack component="ul" direction="row" aria-label={sc.notConfigured.missingLabel} sx={{ flexWrap: 'wrap', gap: 1, p: 0, m: 0, mb: 1, listStyle: 'none' }}>
          {view.scaler.missing.map((env) => (
            <li key={env}>
              <Chip label={env} size="small" variant="outlined" sx={{ fontFamily: 'monospace' }} />
            </li>
          ))}
        </Stack>
        <Typography variant="body2">{sc.notConfigured.enabledHint}</Typography>
      </Alert>,
    );
  } else if (view.scaler.status === 'unavailable') {
    notices.push(
      <Alert key="un" severity="warning">
        <AlertTitle>{sc.unavailable.title}</AlertTitle>
        {sc.unavailable.reasons[view.scaler.reason] ?? sc.unavailable.reasons.upstream}
      </Alert>,
    );
  }
  if (block && block !== 'notReady') {
    notices.push(
      <Alert key="bl" severity="warning">
        <AlertTitle>{sc.blocked.title}</AlertTitle>
        {BLOCK_TEXT[block]}
      </Alert>,
    );
  }
  if (notices.length === 0) return null;
  return <Stack spacing={1.5}>{notices}</Stack>;
}

/** Botão com explicação no Tooltip, inclusive desligado (o `span` recebe o foco e o hover). */
function ActionButton({ label, hint, icon, disabled, onClick, variant = 'outlined' }: {
  label: string; hint: string; icon: LucideIcon; disabled: boolean; onClick: () => void; variant?: 'outlined' | 'contained';
}) {
  return (
    <Tooltip title={hint} arrow>
      <Box component="span" tabIndex={disabled ? 0 : undefined} sx={{ display: 'inline-flex' }}>
        <Button
          variant={variant}
          startIcon={<AppIcon icon={icon} size="sm" />}
          disabled={disabled}
          onClick={onClick}
          sx={{ minHeight: 44 }}
        >
          {label}
        </Button>
      </Box>
    </Tooltip>
  );
}

const OUTCOME_COLOR: Record<WorkerScaleOutcome, 'default' | 'success' | 'error' | 'warning' | 'info'> = {
  requested: 'info', succeeded: 'success', failed: 'error', rejected: 'warning',
};

function OutcomeChip({ event }: { event: WorkerScaleEvent }) {
  const chip = (
    <Chip
      size="small"
      variant="outlined"
      color={OUTCOME_COLOR[event.outcome] ?? 'default'}
      label={sc.history.outcomes[event.outcome] ?? event.outcome}
      tabIndex={event.error ? 0 : undefined}
    />
  );
  return event.error ? <Tooltip title={sc.history.errorHint(event.error)} arrow>{chip}</Tooltip> : chip;
}

/** Recusa antes de ler o escalador grava `fromReplicas = 0`: a origem é desconhecida, não zero. */
function ReplicaChange({ event: e }: { event: WorkerScaleEvent }) {
  const unknownFrom = e.fromReplicas === 0 && e.outcome === 'rejected';
  const label = unknownFrom ? sc.history.unknownChange(e.toReplicas) : sc.dialog.change(e.fromReplicas, e.toReplicas);
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }} aria-label={label}>
      {unknownFrom ? (
        <Tooltip title={sc.history.unknownFromHint} arrow>
          <Box component="span" tabIndex={0} sx={{ color: 'text.secondary', cursor: 'help' }}>{sc.history.unknownFrom}</Box>
        </Tooltip>
      ) : <span>{e.fromReplicas}</span>}
      <AppIcon icon={ArrowRight} size="inline" aria-hidden />
      <span>{e.toReplicas}</span>
    </Stack>
  );
}

function HistoryTable({ w }: { w: ReturnType<typeof useWorkerScale> }) {
  const col = sc.history.columns;
  if (w.events.length === 0 && w.eventsLoading) return <Skeleton variant="rounded" height={120} aria-label={sc.loading} />;
  if (w.events.length === 0 && w.eventsError) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void w.reloadEvents()}>{sc.retry}</Button>}>
        {sc.history.loadFailed}
      </Alert>
    );
  }
  if (w.events.length === 0) return <Typography variant="body2" color="text.secondary">{sc.history.empty}</Typography>;
  return (
    <Stack spacing={1.5}>
      <TableContainer>
        <Table size="small" aria-label={sc.history.aria}>
          <TableHead>
            <TableRow>
              <TableCell>{col.trigger}</TableCell>
              <TableCell>{col.change}</TableCell>
              <TableCell>{col.reason}</TableCell>
              <TableCell>{col.outcome}</TableCell>
              <TableCell align="right">{col.at}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {w.events.map((e) => (
              <TableRow key={e.id}>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{sc.history.triggers[e.trigger] ?? e.trigger}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  <ReplicaChange event={e} />
                </TableCell>
                <TableCell sx={{ minWidth: 180, overflowWrap: 'anywhere' }}>{e.reason}</TableCell>
                <TableCell><OutcomeChip event={e} /></TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{formatDateTime(e.at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {w.eventsError && <Alert severity="error">{sc.history.loadFailed}</Alert>}
      {w.nextCursor && (
        <Box>
          <Button
            variant="text"
            onClick={() => void w.loadMore()}
            disabled={w.eventsLoading}
            startIcon={w.eventsLoading ? <CircularProgress size={16} /> : undefined}
          >
            {sc.history.loadMore}
          </Button>
        </Box>
      )}
    </Stack>
  );
}

/** Aba Escala (WSCALE-14): estado das réplicas, pedido manual com motivo, intervalo mínimo e histórico. */
export default function ScaleTab() {
  const w = useWorkerScale();
  // Re-render ao zerar o intervalo mínimo (a barra avisa uma vez).
  const [, setCooldownTick] = useState(0);

  if (w.loading && !w.view) return <Skeleton variant="rounded" height={320} aria-label={sc.loading} />;
  if (!w.view) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void w.reload()}>{sc.retry}</Button>}>
        {w.loadError ?? sc.errors.loadFailed}
      </Alert>
    );
  }

  const { view } = w;
  const { minReplicas: min, maxReplicas: max, scalerMode, scaleCooldownSeconds } = view.settings;
  const ready = view.scaler.status === 'ready' ? view.scaler : null;
  const block = scaleBlock(view);
  const inCooldown = cooldownActive(view.cooldownUntil, serverNow());
  const current = ready?.desiredReplicas ?? 0;
  const locked = block !== null || inCooldown;

  const lockedHint = (base: string) => {
    if (block === 'notReady') return sc.blocked.notReady;
    if (block) return BLOCK_TEXT[block];
    if (inCooldown) return sc.actions.cooldown;
    return base;
  };
  // ±1 só quando o alvo cai em [min, max]; fora disso o Tooltip mostra a faixa.
  const canUp = scaleStepAllowed(current, 1, min, max);
  const canDown = scaleStepAllowed(current, -1, min, max);
  const upHint = !locked && !canUp ? sc.actions.stepOutOfRange(current + 1, min, max) : lockedHint(sc.actions.upHint);
  const downHint = !locked && !canDown ? sc.actions.stepOutOfRange(current - 1, min, max) : lockedHint(sc.actions.downHint);
  const customHint = !locked && min === max ? sc.actions.singleValueRange(min) : lockedHint(sc.actions.customHint);
  const pendingDraft = w.draft !== null && !(w.dialogOpen && ready);

  return (
    <Stack spacing={3}>
      {w.refreshError && <Alert severity="warning">{sc.refreshFailed}</Alert>}
      {w.notice && (
        <Alert severity={w.notice.severity} onClose={w.clearNotice}>{w.notice.text}</Alert>
      )}
      <ScalerNotice view={view} block={block} />
      {pendingDraft && (
        <Alert
          severity="info"
          action={(
            <Stack direction="row" spacing={1}>
              {ready && (
                <Button color="inherit" size="small" onClick={() => w.openDialog()}>{sc.pendingDraft.reopen}</Button>
              )}
              <Button color="inherit" size="small" onClick={w.cancel}>{sc.pendingDraft.discard}</Button>
            </Stack>
          )}
        >
          {ready ? sc.pendingDraft.text : sc.pendingDraft.waiting}
        </Alert>
      )}

      {/* Box: o Grid com spacing usa margem negativa que o Stack sobrescreve (cards deslocados). */}
      <Box>
        <Grid container spacing={2}>
          <Grid item xs={6} md={3}>
            <Tile label={sc.tiles.desired} help={sc.tiles.desiredHelp} icon={Target} value={ready ? String(ready.desiredReplicas) : null} />
          </Grid>
          <Grid item xs={6} md={3}>
            <Tile label={sc.tiles.running} help={sc.tiles.runningHelp} icon={Server} value={ready ? String(ready.runningReplicas) : null} />
          </Grid>
          <Grid item xs={6} md={3}>
            <Tile label={sc.tiles.mode} help={sc.tiles.modeHelp} icon={SlidersHorizontal} value={sc.modes[scalerMode] ?? scalerMode} />
          </Grid>
          <Grid item xs={6} md={3}>
            <Tile label={sc.tiles.range} help={sc.tiles.rangeHelp} icon={Layers} value={sc.tiles.rangeValue(min, max)} />
          </Grid>
        </Grid>
      </Box>

      <SectionCard title={sc.actions.title}>
        <Stack spacing={2.5}>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5 }}>
            <ActionButton
              label={sc.actions.up}
              hint={upHint}
              icon={ArrowUp}
              variant="contained"
              disabled={locked || !canUp}
              onClick={() => w.openDialog(current + 1)}
            />
            <ActionButton
              label={sc.actions.down}
              hint={downHint}
              icon={ArrowDown}
              disabled={locked || !canDown}
              onClick={() => w.openDialog(current - 1)}
            />
            <ActionButton
              label={sc.actions.custom}
              hint={customHint}
              icon={Gauge}
              disabled={locked || min === max}
              onClick={() => w.openDialog(w.draft ? undefined : defaultScaleTarget(current, min, max))}
            />
          </Stack>
          {inCooldown && view.cooldownUntil && (
            <CooldownBar
              startAt={new Date(view.cooldownUntil).getTime() - scaleCooldownSeconds * 1000}
              endAt={view.cooldownUntil}
              ariaLabel={sc.cooldown.aria}
              label={sc.cooldown.label}
              formatRemaining={formatScaleRemaining}
              doneLabel={sc.cooldown.done}
              tooltip={sc.cooldown.tooltip(formatDateTime(view.cooldownUntil))}
              now={serverNow}
              onComplete={() => {
                setCooldownTick((n) => n + 1);
                void w.refresh();
              }}
            />
          )}
        </Stack>
      </SectionCard>

      <SectionCard title={sc.history.title} subtitle={sc.history.subtitle}>
        <HistoryTable w={w} />
      </SectionCard>

      {/* Diálogo só com o escalador respondendo (precisa das réplicas atuais); sem ele, o aviso acima. */}
      <ScaleConfirmDialog
        draft={w.dialogOpen && ready ? w.draft : null}
        resend={w.resend}
        current={current}
        min={min}
        max={max}
        sending={w.sending}
        error={w.requestError}
        onChange={w.changeDraft}
        onConfirm={() => void w.submit()}
        onClose={w.cancel}
      />
    </Stack>
  );
}

