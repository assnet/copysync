import { Box, MenuItem, TextField, Typography } from '@mui/material';
import { Blurred, useBlur } from '@/features/privacy';
import { sessionStrings } from '@/features/sessions/strings';
import type { SessionItem } from '@/types/api.types';
import { monitoringStrings } from '../strings';

const t = monitoringStrings.page;

interface Props {
  sessions: SessionItem[];
  value: string | null;
  onChange: (sessionId: string) => void;
}

/** Seletor da sessão monitorada (uma configuração por sessão). */
export function MonitoringSessionSelect({ sessions, value, onChange }: Props) {
  const blur = useBlur('monitoring.sessionName');
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const nameOf = (s: SessionItem) => s.name || t.untitledSession;

  return (
    <TextField
      select
      size="small"
      label={t.sessionLabel}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      sx={{ minWidth: { xs: '100%', sm: 240 } }}
      slotProps={{
        htmlInput: { 'aria-label': t.sessionSelectAria },
        select: {
          renderValue: (id) => {
            const s = byId.get(id as string);
            return s ? <Blurred when={blur} inline radius={5}>{nameOf(s)}</Blurred> : '';
          },
        },
      }}
    >
      {sessions.map((s) => (
        <MenuItem key={s.id} value={s.id}>
          <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Blurred when={blur} inline radius={5}>
              <Typography variant="body2" noWrap>{nameOf(s)}</Typography>
            </Blurred>
            <Typography variant="caption" color={s.status === 'CONNECTED' ? 'success.main' : 'text.secondary'}>
              {sessionStrings.status[s.status]}
            </Typography>
          </Box>
        </MenuItem>
      ))}
    </TextField>
  );
}
