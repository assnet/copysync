import {
  Dialog, DialogContent, DialogActions, Box, Button, Typography, IconButton, Tooltip, Divider,
  useMediaQuery, useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { SessionItem, SessionStatus } from '@/types/api.types';
import { sessionStrings } from '../strings';
import { useSessionConnection } from '../hooks/useSessionConnection';
import { SessionConnectPanel } from './SessionConnectPanel';
import { SessionConnectedPanel } from './SessionConnectedPanel';
import { SessionStatusChip } from './SessionStatusChip';

interface Props {
  session: SessionItem | null;
  open: boolean;
  onClose: () => void;
  onStatusChange?: (sessionId: string, status: SessionStatus) => void;
}

/** Conectar/reconectar uma sessão existente — mesmo passo de conexão do assistente. */
export function ConnectSessionDialog({ session, open, onClose, onStatusChange }: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const conn = useSessionConnection({ sessionId: session?.id ?? null, enabled: open, onStatusChange });
  const status = conn.status ?? session?.status ?? null;

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, px: 3, pt: 2.5, pb: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" component="h1" fontWeight={700} noWrap>
            {sessionStrings.connect.dialogTitle(session?.name ?? '')}
          </Typography>
          {status && <Box sx={{ mt: 0.5 }}><SessionStatusChip status={status} /></Box>}
        </Box>
        <Tooltip title={sessionStrings.wizard.close}>
          <IconButton onClick={onClose} aria-label={sessionStrings.wizard.close}>
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </Box>
      <Divider />
      <DialogContent sx={{ px: 3, py: 3 }}>
        {conn.isConnected
          ? <SessionConnectedPanel session={conn.session ?? session} />
          : <SessionConnectPanel conn={conn} />}
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button variant={conn.isConnected ? 'contained' : 'text'} onClick={onClose}>
          {conn.isConnected ? sessionStrings.wizard.finish : sessionStrings.wizard.close}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
