import { useState } from 'react';
import { Alert, Box, Button, Chip, LinearProgress, List, ListItem, ListItemText, Stack, Tooltip, Typography, type ChipProps } from '@mui/material';
import { Pause, Play, Square } from 'lucide-react';
import { AppIcon, ConfirmDialog, CooldownBar, SectionCard } from '@/components';
import { serverToLocal } from '@/services/serverClock';
import { nextDispatchCooldown } from '../utils/dispatchCooldown';
import type { OfferConfigGroup, OfferDispatchItem, OfferDispatchStatus, OfferStatus, SessionItem } from '@/types/api.types';
import { Blurred, useBlur } from '@/features/privacy';
import { offerStrings } from '../strings';

const t = offerStrings.progress;

const STATUS_COLOR: Record<OfferDispatchStatus, ChipProps['color']> = {
  QUEUED: 'default',
  SENDING: 'info',
  SENT: 'success',
  FAILED: 'error',
  SKIPPED: 'warning',
  CANCELLED: 'default',
};

const DONE: ReadonlySet<OfferDispatchStatus> = new Set(['SENT', 'FAILED', 'SKIPPED', 'CANCELLED']);

export type OfferControlAction = 'pause' | 'resume' | 'cancel';

interface Props {
  status: OfferStatus;
  dispatches: OfferDispatchItem[];
  /** Títulos vindos da configuração; grupo que saiu dela aparece como removido. */
  destinations: OfferConfigGroup[];
  /** Sessões da configuração: com mais de uma, cada linha mostra por qual número sai. */
  sessions: SessionItem[];
  /** Pausar / retomar / parar; ausente = sem controles (ex.: leitura). */
  onControl?: (action: OfferControlAction) => void;
  controlling?: boolean;
}

/**
 * Situação do envio por destino. Os dados chegam pelo polling do hook enquanto a oferta está
 * `SENDING`/`PAUSED`. Controles: pausar segura a fila, retomar reagenda, parar é final.
 */
export function OfferDispatchProgress({ status, dispatches, destinations, sessions, onControl, controlling = false }: Props) {
  const titles = new Map(destinations.map((d) => [d.conversationId, d.title]));
  const sessionNames = new Map(sessions.map((s) => [s.id, s.name]));
  const sessionOf = (conversationId: string) => {
    const sid = destinations.find((d) => d.conversationId === conversationId)?.sessionId;
    return sid ? sessionNames.get(sid) ?? null : null;
  };
  const multi = sessions.length > 1;
  const blurSession = useBlur('offers.sessionName');
  const [stopOpen, setStopOpen] = useState(false);
  const done = dispatches.filter((d) => DONE.has(d.status)).length;
  const sent = dispatches.filter((d) => d.status === 'SENT').length;
  const cancelled = dispatches.filter((d) => d.status === 'CANCELLED').length;
  const remaining = dispatches.filter((d) => d.status === 'QUEUED').length;
  const total = dispatches.length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const active = status === 'SENDING' || status === 'PAUSED';
  const cooldown = active ? nextDispatchCooldown(dispatches) : null;

  return (
    <SectionCard
      title={t.title}
      action={active && onControl ? (
        <Stack direction="row" spacing={1}>
          {status === 'SENDING' ? (
            <Tooltip title={t.controls.pauseTooltip} arrow>
              <span>
                <Button size="small" variant="outlined" color="inherit" startIcon={<AppIcon icon={Pause} size="sm" />} disabled={controlling || remaining === 0} onClick={() => onControl('pause')}>
                  {t.controls.pause}
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Tooltip title={t.controls.resumeTooltip} arrow>
              <span>
                <Button size="small" variant="contained" disableElevation startIcon={<AppIcon icon={Play} size="sm" />} disabled={controlling} onClick={() => onControl('resume')}>
                  {t.controls.resume}
                </Button>
              </span>
            </Tooltip>
          )}
          <Tooltip title={t.controls.stopTooltip} arrow>
            <span>
              <Button size="small" variant="outlined" color="error" startIcon={<AppIcon icon={Square} size="sm" />} disabled={controlling} onClick={() => setStopOpen(true)}>
                {t.controls.stop}
              </Button>
            </span>
          </Tooltip>
        </Stack>
      ) : undefined}
    >
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary" role="status" aria-atomic="true" sx={{ mb: 1 }}>
          {t.summary(done, total)}
        </Typography>
        <LinearProgress
          variant={status === 'SENDING' && done === 0 ? 'indeterminate' : 'determinate'}
          value={percent}
          aria-label={t.summary(done, total)}
          color={status === 'FAILED' ? 'error' : status === 'PAUSED' ? 'warning' : 'primary'}
          sx={{ height: 6, borderRadius: 3 }}
        />
      </Box>

      {cooldown && status === 'SENDING' && (
        <Box sx={{ mb: 2 }}>
          <CooldownBar
            key={cooldown.next.id}
            startAt={cooldown.startMs}
            endAt={cooldown.endMs}
            ariaLabel={t.nextSendAria}
            label={t.nextSend(titles.get(cooldown.next.conversationId) || t.unknownDestination, multi ? sessionOf(cooldown.next.conversationId) : null)}
            formatRemaining={t.remaining}
            doneLabel={t.nextSendDone}
            tooltip={t.nextSendAt(serverToLocal(cooldown.endMs).toLocaleTimeString())}
          />
        </Box>
      )}

      {status === 'PAUSED' && <Alert severity="warning" icon={<AppIcon icon={Pause} size="sm" />} sx={{ mb: 2 }}>{t.paused}</Alert>}
      {status === 'SENT' && <Alert severity="success" sx={{ mb: 2 }}>{t.finishedSent}</Alert>}
      {status === 'FAILED' && <Alert severity="error" sx={{ mb: 2 }}>{t.finishedFailed}</Alert>}
      {status === 'CANCELLED' && <Alert severity="info" sx={{ mb: 2 }}>{t.finishedCancelled(sent, cancelled)}</Alert>}

      <List dense disablePadding>
        {dispatches.map((d) => (
          <ListItem
            key={d.id}
            divider
            secondaryAction={
              <Chip
                size="small"
                label={status === 'PAUSED' && d.status === 'QUEUED' ? t.pausedBar : t.status[d.status]}
                color={STATUS_COLOR[d.status]}
                variant={d.status === 'QUEUED' || d.status === 'CANCELLED' ? 'outlined' : 'filled'}
              />
            }
            sx={{ pr: 14, opacity: d.status === 'CANCELLED' ? 0.6 : 1 }}
          >
            <ListItemText
              primary={titles.get(d.conversationId) || t.unknownDestination}
              secondary={
                d.status === 'FAILED' || d.status === 'SKIPPED'
                  ? (d.failureReason && t.failureReasons[d.failureReason])
                    || (d.status === 'SKIPPED' ? t.failureReasons.skipped : t.failureReasons.generic)
                  : multi && sessionOf(d.conversationId)
                    ? <Blurred when={blurSession} inline radius={4}>{t.viaSession(sessionOf(d.conversationId)!)}</Blurred>
                    : undefined
              }
              slotProps={{ primary: { noWrap: true } }}
            />
          </ListItem>
        ))}
      </List>

      <ConfirmDialog
        open={stopOpen}
        title={t.controls.stopConfirmTitle}
        description={t.controls.stopConfirmDescription(remaining)}
        confirmLabel={t.controls.stopConfirm}
        cancelLabel={t.controls.stopCancel}
        confirmColor="error"
        onConfirm={() => { setStopOpen(false); onControl?.('cancel'); }}
        onClose={() => setStopOpen(false)}
      />
    </SectionCard>
  );
}
