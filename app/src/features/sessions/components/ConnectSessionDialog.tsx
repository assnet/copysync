import {
  Dialog, DialogContent, DialogActions, Box, Button, Typography, IconButton, Tooltip, Divider,
  useMediaQuery, useTheme,
} from '@mui/material';
import { X } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import type { SessionItem, SessionStatus } from '@/types/api.types';
import { sessionStrings } from '../strings';
import { TELEGRAM_QR_TTL_MS, isTelegramSession } from '../utils';
import { useSessionConnection } from '../hooks/useSessionConnection';
import { useTelegramLogin } from '../hooks/useTelegramLogin';
import { SessionConnectPanel } from './SessionConnectPanel';
import { TelegramConnectPanel } from './TelegramConnectPanel';
import { SessionConnectedPanel } from './SessionConnectedPanel';
import { SessionStatusChip } from './SessionStatusChip';

interface Props {
  session: SessionItem | null;
  open: boolean;
  onClose: () => void;
  onStatusChange?: (sessionId: string, status: SessionStatus) => void;
}

/** Conectar/reconectar uma sessão existente — mesmo passo de conexão do assistente, por canal. */
export function ConnectSessionDialog({ session, open, onClose, onStatusChange }: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const telegram = session ? isTelegramSession(session) : false;
  const blurName = useBlur('sessions.sessionName');
  // Telegram: o cartão já disparou connect/reconnect (login por QR) → abre em QR; a partir de
  // AWAITING_CODE/PASSWORD (login por código em andamento) abre no código.
  const openedByCode = session?.status === 'AWAITING_CODE' || session?.status === 'AWAITING_PASSWORD';
  const conn = useSessionConnection({
    sessionId: session?.id ?? null,
    enabled: open,
    onStatusChange,
    qrTtlMs: telegram ? TELEGRAM_QR_TTL_MS : undefined,
    initialMode: telegram && openedByCode ? 'code' : 'qr',
  });
  const login = useTelegramLogin(open && telegram ? session?.id ?? null : null, conn);
  const status = conn.status ?? session?.status ?? null;

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, px: 3, pt: 2.5, pb: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Blurred when={blurName} inline>
            <Typography variant="h6" component="h1" fontWeight={700} noWrap>
              {sessionStrings.connect.dialogTitle(session?.name ?? '')}
            </Typography>
          </Blurred>
          {status && <Box sx={{ mt: 0.5 }}><SessionStatusChip status={status} /></Box>}
        </Box>
        <Tooltip title={sessionStrings.wizard.close}>
          <IconButton onClick={onClose} aria-label={sessionStrings.wizard.close}>
            <AppIcon icon={X} size="lg" />
          </IconButton>
        </Tooltip>
      </Box>
      <Divider />
      <DialogContent sx={{ px: 3, py: 3 }}>
        {conn.isConnected
          ? <SessionConnectedPanel session={conn.session ?? session} />
          : telegram
            ? <TelegramConnectPanel conn={conn} login={login} phone={session?.declaredPhone} />
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
