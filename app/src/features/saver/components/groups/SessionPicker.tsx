import { Box, MenuItem, TextField, Typography } from '@mui/material';
import { ChannelLogo } from '@/features/sessions/components/ChannelLogo';
import { sessionStrings } from '@/features/sessions/strings';
import { channelOf } from '@/features/sessions/utils';
import type { SessionItem } from '@/types/api.types';
import { saverStrings } from '../../strings';

const t = saverStrings.groups.session;

interface Props {
  sessions: SessionItem[];
  value: string | null;
  onChange: (sessionId: string) => void;
}

/** Seletor da sessão cujos grupos serão lidos. Lista também Telegram: a tela avisa que não é suportado. */
export function SessionPicker({ sessions, value, onChange }: Props) {
  const nameOf = (s: SessionItem) => s.name || t.untitled;
  const channelName = (s: SessionItem) => (channelOf(s.engine) === 'telegram' ? t.telegram : t.whatsapp);
  return (
    <TextField
      select
      size="small"
      label={t.label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      sx={{ minWidth: { xs: '100%', sm: 300 } }}
    >
      {sessions.map((s) => (
        <MenuItem key={s.id} value={s.id} sx={{ gap: 1.25, minHeight: 48 }}>
          <ChannelLogo channel={channelOf(s.engine)} />
          <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{nameOf(s)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {channelName(s)} · {sessionStrings.status[s.status] ?? s.status}
            </Typography>
          </Box>
        </MenuItem>
      ))}
    </TextField>
  );
}
