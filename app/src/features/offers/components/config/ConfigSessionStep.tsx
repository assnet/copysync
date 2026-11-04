import { Link as RouterLink } from 'react-router-dom';
import { Alert, Avatar, Box, Button, Card, CardActionArea, Checkbox, Chip, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import { Smartphone } from 'lucide-react';
import { AppIcon, EmptyState } from '@/components';
import { ChannelLogo } from '@/features/sessions/components/ChannelLogo';
import { channelOf } from '@/features/sessions/utils';
import type { OfferConfigResponse, SessionItem } from '@/types/api.types';
import { CHANNELS, countByChannel } from '../../utils/offerConfig';
import { ChannelCounterChips } from './ChannelCounterChips';
import { resolveMediaUrl } from '@/utils/resolveMediaUrl';
import { offerStrings } from '../../strings';
import { Blurred, useBlur } from '@/features/privacy';
import { sessionColor } from './DispatchOrderPicker';

const t = offerStrings.wizard.session;

interface Props {
  sessions: SessionItem[];
  loading: boolean;
  failed: boolean;
  /** Na ordem de escolha = ordem de envio. */
  selectedIds: readonly string[];
  /** Limites por canal (`whatsapp_sessions`, `telegram_sessions`); null = sem limite. */
  limits: OfferConfigResponse['limits'];
  onToggle: (id: string) => void;
  onRetry: () => void;
}

/** Passo 1: sessões conectadas em cartões de escolha múltipla; o número mostra a ordem de envio. */
export function ConfigSessionStep({ sessions, loading, failed, selectedIds, limits, onToggle, onRetry }: Props) {
  const blurSession = useBlur('offers.sessionName');
  const channelOfId = (id: string) => channelOf(sessions.find((s) => s.id === id)?.engine);
  const count = countByChannel(selectedIds.map(channelOfId));
  const channels = CHANNELS.filter((ch) => sessions.some((s) => channelOf(s.engine) === ch));
  const sessionLimits = { whatsapp: limits.whatsapp.sessions, telegram: limits.telegram.sessions };

  if (failed) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={onRetry}>{offerStrings.page.retry}</Button>}>
        {t.loadError}
      </Alert>
    );
  }

  if (loading) {
    return (
      <Box sx={gridSx}>
        {[0, 1].map((i) => <Skeleton key={i} variant="rounded" height={88} />)}
      </Box>
    );
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={<AppIcon icon={Smartphone} size="lg" />}
        title={t.emptyTitle}
        description={t.emptyDescription}
        action={<Button variant="contained" disableElevation component={RouterLink} to="/settings/sessions">{t.emptyAction}</Button>}
      />
    );
  }

  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <ChannelCounterChips
          channels={channels}
          count={count}
          limits={sessionLimits}
          label={t.channelCounter}
          ariaLabel={t.channelCounterAria}
        />
      </Box>

      <Box role="group" aria-label={t.title} sx={gridSx}>
        {sessions.map((s) => {
          const position = selectedIds.indexOf(s.id);
          const selected = position >= 0;
          const channel = channelOf(s.engine);
          const limit = sessionLimits[channel];
          const blocked = !selected && limit != null && count[channel] >= limit;
          const card = (
            <Card
              variant="outlined"
              sx={{
                borderColor: selected ? sessionColor(position) : 'divider',
                borderWidth: selected ? 2 : 1,
                opacity: blocked ? 0.55 : 1,
                transition: 'border-color 150ms ease',
              }}
            >
              <CardActionArea
                role="checkbox"
                aria-checked={selected}
                aria-disabled={blocked}
                disabled={blocked}
                onClick={() => onToggle(s.id)}
                sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5, justifyContent: 'flex-start', minHeight: 72 }}
              >
                <Avatar src={resolveMediaUrl(s.avatarUrl ?? null) ?? undefined} alt="" sx={{ width: 44, height: 44 }}>
                  <Blurred when={blurSession} inline radius={4}>{s.name.slice(0, 1).toUpperCase()}</Blurred>
                </Avatar>
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                    <ChannelLogo channel={channel} size="sm" labelled />
                    <Typography variant="subtitle2" noWrap><Blurred when={blurSession} inline radius={5}>{s.name}</Blurred></Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary" noWrap><Blurred when={blurSession} inline radius={5}>{s.phone ?? t.noPhone}</Blurred></Typography>
                </Box>
                <Stack alignItems="flex-end" spacing={0.5}>
                  {selected ? (
                    <Chip
                      size="small"
                      label={t.orderBadge(position + 1)}
                      sx={{ fontWeight: 700, color: '#fff', backgroundColor: sessionColor(position) }}
                    />
                  ) : (
                    <Chip size="small" color="success" variant="outlined" label={t.connected} />
                  )}
                  <Checkbox checked={selected} tabIndex={-1} disableRipple size="small" sx={{ p: 0 }} slotProps={{ input: { 'aria-hidden': true } }} />
                </Stack>
              </CardActionArea>
            </Card>
          );
          return blocked && limit != null ? (
            <Tooltip key={s.id} title={t.channelLimitTooltip(channel, limit)} arrow>
              <Box component="span" sx={{ display: 'block' }}>{card}</Box>
            </Tooltip>
          ) : (
            <Box key={s.id}>{card}</Box>
          );
        })}
      </Box>
    </Stack>
  );
}

const gridSx = {
  display: 'grid',
  gap: 1.5,
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
} as const;
