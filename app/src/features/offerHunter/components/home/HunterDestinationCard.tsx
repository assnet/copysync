import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import {
  Alert, Avatar, Box, Button, Paper, Skeleton, Stack, Tooltip, Typography,
} from '@mui/material';
import { ArrowLeftRight, MessageCircle, Users } from 'lucide-react';
import { AppIcon, OverflowTooltipText } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { GroupAvatar } from '@/features/offers/components/GroupChip';
import { useSessionGroups } from '@/features/offers/hooks/useSessionGroups';
import type { SessionItem } from '@/types/api.types';
import { offerHunterStrings } from '../../strings';
import type { HunterSettings, SaveHunterSettingsInput } from '../../types';
import { DestinationPickerDialog } from './DestinationPickerDialog';

const t = offerHunterStrings.destination;

export interface HunterDestinationCardHandle {
  /** Leva o foco ao cartão e abre o seletor (ação do portão "destino"). */
  focusAndPick: () => void;
}

export interface HunterDestinationCardProps {
  settings: HunterSettings | null;
  loading: boolean;
  sessions: SessionItem[];
  sessionsLoading: boolean;
  sessionsFailed: boolean;
  onRetrySessions: () => void;
  onSave: (body: SaveHunterSettingsInput) => Promise<unknown>;
  /** Portões de plano fechados: não deixa trocar (a API recusaria). */
  disabled?: boolean;
  disabledReason?: string;
}

/** Grupo de destino único do caçador: sessão e grupo atuais, com o seletor para trocar. */
export const HunterDestinationCard = forwardRef<HunterDestinationCardHandle, HunterDestinationCardProps>(function HunterDestinationCard(
  { settings, loading, sessions, sessionsLoading, sessionsFailed, onRetrySessions, onSave, disabled, disabledReason },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Seletor aberto sobrevive a reload (estado de interface; o rascunho fica no próprio seletor).
  const [pickerOpen, setPickerOpen, clearPickerOpen] = usePersistedState('offerHunter.destinationPickerOpen', false, { scope: 'tab', version: 1 });
  const blurSession = useBlur('offerHunter.sessionName');
  const blurGroup = useBlur('offerHunter.groupNames');

  useImperativeHandle(ref, () => ({
    focusAndPick: () => {
      rootRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      rootRef.current?.focus();
      if (!disabled) setPickerOpen(true);
    },
  }), [disabled]);

  const sessionId = settings?.sessionId ?? null;
  const ids = useMemo(() => (sessionId ? [sessionId] : []), [sessionId]);
  const groups = useSessionGroups(ids, '');
  const session = sessions.find((s) => s.id === sessionId) ?? null;
  const group = groups.items.find((gr) => gr.conversationId === settings?.conversationId) ?? null;
  const hasDestination = Boolean(settings?.sessionId && settings?.conversationId);
  const invalid = Boolean(settings && hasDestination && !settings.valid);

  const sessionName = session?.name || t.unnamedSession;
  const groupName = group?.title || t.unnamedGroup;

  return (
    <Paper
      ref={rootRef}
      tabIndex={-1}
      variant="outlined"
      component="section"
      aria-labelledby="hunter-destination-title"
      sx={{ p: { xs: 2, sm: 2.5 }, mb: 3, outline: 'none', '&:focus-visible': { borderColor: 'primary.main' } }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography id="hunter-destination-title" variant="subtitle1" fontWeight={700}>{t.title}</Typography>
          <Typography variant="caption" color="text.secondary" display="block">{t.subtitle}</Typography>

          {loading && !settings ? (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 1.5 }} role="status" aria-label={t.title}>
              <Skeleton variant="circular" width={40} height={40} />
              <Box sx={{ flexGrow: 1 }}><Skeleton width="50%" /><Skeleton width="30%" /></Box>
            </Stack>
          ) : hasDestination ? (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 1.5, minWidth: 0 }}>
              {groups.loading && !group ? (
                <Skeleton variant="circular" width={40} height={40} />
              ) : (
                <GroupAvatar title={group?.title ?? null} avatarUrl={group?.avatarUrl ?? null} size={40} blurFlag="offerHunter.groupAvatars" />
              )}
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                {groups.loading && !group ? <Skeleton width="60%" /> : (
                  <OverflowTooltipText text={groupName} disabled={blurGroup} typographyProps={{ variant: 'body2', fontWeight: 600 }}>
                    <Blurred when={blurGroup} inline radius={5}>{groupName}</Blurred>
                  </OverflowTooltipText>
                )}
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0, color: 'text.secondary' }}>
                  {session?.avatarUrl ? (
                    <Avatar src={session.avatarUrl} alt="" sx={{ width: 16, height: 16, ...(blurSession && { filter: 'blur(4px)' }) }} />
                  ) : (
                    <AppIcon icon={MessageCircle} size="inline" />
                  )}
                  <Typography variant="caption" component="span" sx={{ flexShrink: 0 }}>{t.session}:</Typography>
                  <OverflowTooltipText text={sessionName} disabled={blurSession} typographyProps={{ variant: 'caption' }}>
                    <Blurred when={blurSession} inline radius={5}>{sessionName}</Blurred>
                  </OverflowTooltipText>
                </Stack>
              </Box>
            </Stack>
          ) : (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 1.5 }}>
              <Avatar sx={{ width: 40, height: 40, bgcolor: 'action.hover', color: 'text.disabled' }}>
                <AppIcon icon={Users} size="md" />
              </Avatar>
              <Box>
                <Typography variant="body2" fontWeight={600}>{t.empty}</Typography>
                <Typography variant="caption" color="text.secondary">{t.emptyHint}</Typography>
              </Box>
            </Stack>
          )}
        </Box>

        <Tooltip title={disabled ? (disabledReason ?? '') : (hasDestination ? t.change : t.choose)} describeChild>
          <span style={{ flexShrink: 0 }}>
            <Button
              variant={hasDestination ? 'outlined' : 'contained'}
              startIcon={<AppIcon icon={hasDestination ? ArrowLeftRight : Users} size="sm" />}
              onClick={() => setPickerOpen(true)}
              disabled={disabled || (loading && !settings)}
              fullWidth
            >
              {hasDestination ? t.change : t.choose}
            </Button>
          </span>
        </Tooltip>
      </Stack>

      {invalid && <Alert severity="warning" variant="outlined" sx={{ mt: 2 }}>{t.invalid}</Alert>}

      <DestinationPickerDialog
        open={pickerOpen}
        current={settings}
        sessions={sessions}
        sessionsLoading={sessionsLoading}
        sessionsFailed={sessionsFailed}
        onRetrySessions={onRetrySessions}
        onClose={clearPickerOpen}
        onSave={async (body) => {
          await onSave(body);
          clearPickerOpen();
        }}
      />
    </Paper>
  );
});
