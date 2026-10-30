import { Avatar, Box, MenuItem, TextField, Typography, useTheme } from '@mui/material';
import { Smartphone } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { sessionStrings } from '@/features/sessions/strings';
import type { SessionItem } from '@/types/api.types';
import { toneMain } from '../monitoringStyle';
import { monitoringStrings } from '../strings';
import { SESSION_STATUS_TONE } from './SessionSummaryCard';

const t = monitoringStrings.page;

interface Props {
  sessions: SessionItem[];
  value: string | null;
  onChange: (sessionId: string) => void;
}

/** Ponto de status da sessão (decorativo: o status também vai em texto). */
function StatusDot({ session }: { session: SessionItem }) {
  const theme = useTheme();
  return <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: toneMain(theme, SESSION_STATUS_TONE[session.status]) }} />;
}

/** Seletor da sessão monitorada (uma configuração por sessão). */
export function MonitoringSessionSelect({ sessions, value, onChange }: Props) {
  const blurName = useBlur('monitoring.sessionName');
  const blurAvatar = useBlur('monitoring.sessionAvatar');
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const nameOf = (s: SessionItem) => s.name || t.untitledSession;

  return (
    <TextField
      select
      size="small"
      label={t.sessionLabel}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      sx={{ minWidth: { xs: '100%', sm: 260 }, '& .MuiInputBase-root': { borderRadius: '12px', bgcolor: 'background.paper' } }}
      slotProps={{
        htmlInput: { 'aria-label': t.sessionSelectAria },
        select: {
          renderValue: (id) => {
            const s = byId.get(id as string);
            if (!s) return '';
            return (
              <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <StatusDot session={s} />
                <Blurred when={blurName} inline radius={5}>
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(s)}</Box>
                </Blurred>
              </Box>
            );
          },
        },
      }}
    >
      {sessions.map((s) => (
        <MenuItem key={s.id} value={s.id} sx={{ gap: 1.25, minHeight: 48 }}>
          <Avatar
            src={s.avatarUrl ?? undefined}
            alt=""
            sx={{ width: 24, height: 24, bgcolor: 'action.selected', color: 'text.secondary', ...(blurAvatar && { filter: 'blur(6px)' }) }}
          >
            <AppIcon icon={Smartphone} size="sm" />
          </Avatar>
          <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Blurred when={blurName} inline radius={5}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{nameOf(s)}</Typography>
            </Blurred>
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
              <StatusDot session={s} />
              <Typography variant="caption" color="text.secondary">{sessionStrings.status[s.status]}</Typography>
            </Box>
          </Box>
        </MenuItem>
      ))}
    </TextField>
  );
}
