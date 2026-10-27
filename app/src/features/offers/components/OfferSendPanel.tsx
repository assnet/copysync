import { useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { CalendarClock } from 'lucide-react';
import { AppIcon, SectionCard, ToggleOption } from '@/components';
import type { OfferConfigGroup, OfferItem } from '@/types/api.types';
import { offerStrings } from '../strings';
import { TYPING_SECONDS_MAX, TYPING_SECONDS_MIN } from '../utils/offerConfig';
import {
  SCHEDULE_MAX_DAYS, defaultScheduleInput, fromLocalInput, isPendingSchedule, scheduleProblem, toLocalInput,
} from '../utils/offerSchedule';
import { GroupChip } from './GroupChip';
import { OfferScheduleField } from './OfferScheduleField';

const t = offerStrings.actions;
const ts = offerStrings.schedule;
const MAX_CHIPS = 6;

interface Props {
  offer: OfferItem;
  groups: OfferConfigGroup[];
  /** Outra ação em curso na oferta (salvar, gerar de novo, foto…). */
  busy: boolean;
  sending: boolean;
  mentionSaving: boolean;
  /** Plano recusou "marcar todos": mostra o aviso de upgrade sob a chave. */
  mentionUnavailable: boolean;
  /** Bloqueia o disparo (sessão desconectada, sem grupos…). */
  sendBlocked: boolean;
  textTooLong: boolean;
  /** Editor da prévia aberto: segura o disparo. */
  editing: boolean;
  onMentionAll: (value: boolean) => void;
  onTyping: (patch: { simulateTyping?: boolean; typingSeconds?: number }) => void;
  /** Grava o início agendado (ISO) ou remove (null). */
  onSchedule: (scheduledAt: string | null) => Promise<void>;
  onSend: () => void;
}

/**
 * Card "Envio" da oferta em rascunho: marcar todos, digitando, início agendado, destinos e
 * disparo. Depois do disparo o lugar dele é do progresso (`OfferDispatchProgress`).
 */
export function OfferSendPanel(props: Props) {
  const { offer, groups, busy, sending, mentionSaving, mentionUnavailable, sendBlocked, textTooLong, editing } = props;
  const [scheduleOn, setScheduleOn] = useState(offer.scheduledAt != null);
  const [scheduleValue, setScheduleValue] = useState(offer.scheduledAt ? toLocalInput(new Date(offer.scheduledAt)) : '');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const scheduled = scheduleOn && isPendingSchedule(offer.scheduledAt);
  const expired = offer.scheduledAt != null && !isPendingSchedule(offer.scheduledAt);

  const save = async (iso: string | null) => {
    setScheduleSaving(true);
    try {
      await props.onSchedule(iso);
    } catch {
      // Mensagem vem do hook; o campo volta ao valor gravado
      setScheduleError(ts.invalid);
    } finally {
      setScheduleSaving(false);
    }
  };

  /** Grava só valor válido e diferente do atual. */
  const commitSchedule = (value: string) => {
    const problem = scheduleProblem(value);
    if (problem) {
      setScheduleError(problem === 'required' ? ts.required : problem === 'past' ? ts.past : ts.tooFar(SCHEDULE_MAX_DAYS));
      return;
    }
    const iso = fromLocalInput(value);
    if (iso && iso !== offer.scheduledAt) void save(iso);
  };

  const toggleSchedule = (on: boolean) => {
    setScheduleOn(on);
    setScheduleError(null);
    if (on) {
      const value = scheduleValue && !scheduleProblem(scheduleValue) ? scheduleValue : defaultScheduleInput();
      setScheduleValue(value);
      commitSchedule(value);
    } else if (offer.scheduledAt) {
      void save(null);
    }
  };

  const shown = groups.slice(0, MAX_CHIPS);
  const rest = groups.length - shown.length;
  const untitled = offerStrings.wizard.groups.untitled;

  return (
    <SectionCard title={offerStrings.send.title}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">{offerStrings.send.idle}</Typography>
        <ToggleOption
          checked={offer.mentionAll}
          disabled={mentionSaving || busy}
          onChange={(v) => props.onMentionAll(v)}
          title={t.mentionAll}
          description={
            <Box component="span" sx={{ color: mentionUnavailable ? 'warning.main' : undefined }}>
              {mentionUnavailable ? t.mentionAllUnavailable : t.mentionAllHelper}
            </Box>
          }
        />

        <ToggleOption
          checked={offer.simulateTyping}
          disabled={busy}
          onChange={(v) => props.onTyping({ simulateTyping: v })}
          title={t.simulateTyping}
          description={t.simulateTypingHelper}
        >
            <Stack direction="row" alignItems="center" spacing={1} role="group" aria-label={t.typingDuration}>
              <Typography variant="body2" color="text.secondary">{t.typingDuration}</Typography>
              <Tooltip title={t.typingDecrease} arrow>
                <span>
                  <IconButton
                    size="small"
                    aria-label={t.typingDecrease}
                    disabled={busy || offer.typingSeconds <= TYPING_SECONDS_MIN}
                    onClick={() => props.onTyping({ typingSeconds: offer.typingSeconds - 1 })}
                  >
                    <RemoveIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Typography
                variant="body2"
                fontWeight={600}
                aria-live="polite"
                sx={{ minWidth: 40, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
              >
                {t.typingSeconds(offer.typingSeconds)}
              </Typography>
              <Tooltip title={t.typingIncrease} arrow>
                <span>
                  <IconButton
                    size="small"
                    aria-label={t.typingIncrease}
                    disabled={busy || offer.typingSeconds >= TYPING_SECONDS_MAX}
                    onClick={() => props.onTyping({ typingSeconds: offer.typingSeconds + 1 })}
                  >
                    <AddIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
        </ToggleOption>

        <OfferScheduleField
          enabled={scheduleOn}
          value={scheduleValue}
          onToggle={toggleSchedule}
          onChange={(v) => { setScheduleValue(v); setScheduleError(null); }}
          onCommit={() => commitSchedule(scheduleValue)}
          error={scheduleError}
          disabled={busy || scheduleSaving}
        />
        {expired && <Alert severity="info">{offerStrings.schedule.expired}</Alert>}

        <Box>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 0.75 }}>{t.destinations}</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {shown.map((g) => <GroupChip key={g.conversationId} title={g.title} avatarUrl={g.avatarUrl} untitled={untitled} sx={{ maxWidth: 220 }} />)}
            {rest > 0 && (
              <Tooltip title={groups.slice(MAX_CHIPS).map((g) => g.title || untitled).join(', ')} arrow>
                <Chip size="small" variant="outlined" label={t.moreGroups(rest)} tabIndex={0} />
              </Tooltip>
            )}
          </Box>
        </Box>

        <Button
          variant="contained"
          size="large"
          disableElevation
          fullWidth
          startIcon={sending ? <CircularProgress size={18} color="inherit" /> : scheduled ? <AppIcon icon={CalendarClock} size="sm" /> : <SendOutlinedIcon />}
          disabled={sendBlocked || busy || textTooLong || editing || scheduleSaving || Boolean(scheduleError)}
          onClick={props.onSend}
        >
          {sending
            ? offerStrings.send.sending
            : scheduled ? offerStrings.send.buttonScheduled(groups.length)
              : groups.length === 1 ? offerStrings.send.buttonSingle : offerStrings.send.button(groups.length)}
        </Button>
      </Stack>
    </SectionCard>
  );
}
