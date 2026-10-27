import { Alert, Box, Chip, LinearProgress, List, ListItem, ListItemText, Typography, type ChipProps } from '@mui/material';
import { CooldownBar, SectionCard } from '@/components';
import { serverToLocal } from '@/services/serverClock';
import { nextDispatchCooldown } from '../utils/dispatchCooldown';
import type { OfferConfigGroup, OfferDispatchItem, OfferDispatchStatus, OfferStatus } from '@/types/api.types';
import { offerStrings } from '../strings';

const t = offerStrings.progress;

const STATUS_COLOR: Record<OfferDispatchStatus, ChipProps['color']> = {
  QUEUED: 'default',
  SENDING: 'info',
  SENT: 'success',
  FAILED: 'error',
  SKIPPED: 'warning',
};

const DONE: ReadonlySet<OfferDispatchStatus> = new Set(['SENT', 'FAILED', 'SKIPPED']);

interface Props {
  status: OfferStatus;
  dispatches: OfferDispatchItem[];
  /** Títulos vindos da configuração; grupo que saiu dela aparece como removido. */
  destinations: OfferConfigGroup[];
}

/** Situação do envio por destino. Os dados chegam pelo polling do hook enquanto a oferta está `SENDING`. */
export function OfferDispatchProgress({ status, dispatches, destinations }: Props) {
  const titles = new Map(destinations.map((d) => [d.conversationId, d.title]));
  const done = dispatches.filter((d) => DONE.has(d.status)).length;
  const total = dispatches.length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const cooldown = status === 'SENDING' ? nextDispatchCooldown(dispatches) : null;

  return (
    <SectionCard title={t.title}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary" role="status" aria-atomic="true" sx={{ mb: 1 }}>
          {t.summary(done, total)}
        </Typography>
        <LinearProgress
          variant={status === 'SENDING' && done === 0 ? 'indeterminate' : 'determinate'}
          value={percent}
          aria-label={t.summary(done, total)}
          color={status === 'FAILED' ? 'error' : 'primary'}
          sx={{ height: 6, borderRadius: 3 }}
        />
      </Box>

      {cooldown && (
        <Box sx={{ mb: 2 }}>
          <CooldownBar
            key={cooldown.next.id}
            startAt={cooldown.startMs}
            endAt={cooldown.endMs}
            ariaLabel={t.nextSendAria}
            label={t.nextSend(titles.get(cooldown.next.conversationId) || t.unknownDestination)}
            formatRemaining={t.remaining}
            doneLabel={t.nextSendDone}
            tooltip={t.nextSendAt(serverToLocal(cooldown.endMs).toLocaleTimeString())}
          />
        </Box>
      )}

      {status === 'SENT' && <Alert severity="success" sx={{ mb: 2 }}>{t.finishedSent}</Alert>}
      {status === 'FAILED' && <Alert severity="error" sx={{ mb: 2 }}>{t.finishedFailed}</Alert>}

      <List dense disablePadding>
        {dispatches.map((d) => (
          <ListItem
            key={d.id}
            divider
            secondaryAction={
              <Chip size="small" label={t.status[d.status]} color={STATUS_COLOR[d.status]} variant={d.status === 'QUEUED' ? 'outlined' : 'filled'} />
            }
            sx={{ pr: 14 }}
          >
            <ListItemText
              primary={titles.get(d.conversationId) || t.unknownDestination}
              secondary={
                d.status === 'FAILED' || d.status === 'SKIPPED'
                  ? (d.failureReason && t.failureReasons[d.failureReason])
                    || (d.status === 'SKIPPED' ? t.failureReasons.skipped : t.failureReasons.generic)
                  : undefined
              }
              slotProps={{ primary: { noWrap: true } }}
            />
          </ListItem>
        ))}
      </List>
    </SectionCard>
  );
}
