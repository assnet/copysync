import { useState } from 'react';
import {
  Card,
  CardContent,
  CardActions,
  Typography,
  Box,
  Button,
  Divider,
  IconButton,
  Tooltip,
  Chip,
  CircularProgress,
} from '@mui/material';
import QrCodeIcon from '@mui/icons-material/QrCode2';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import RefreshIcon from '@mui/icons-material/Refresh';
import LogoutIcon from '@mui/icons-material/Logout';
import { sessionService } from '@/services/session.service';
import { SessionStatusChip } from './SessionStatusChip';
import type { SessionItem, SessionStatus } from '@/types/api.types';

interface Props {
  session: SessionItem;
  onRequestQr: (session: SessionItem) => void;
  onStatusChange: (sessionId: string, status: SessionStatus) => void;
}

type Action = 'connect' | 'disconnect' | 'reconnect' | 'logout';

export function SessionCard({ session, onRequestQr, onStatusChange }: Props) {
  const [loadingAction, setLoadingAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(action: Action) {
    setLoadingAction(action);
    setError(null);

    try {
      switch (action) {
        case 'connect': {
          const res = await sessionService.connect(session.id);
          onStatusChange(session.id, res.status);
          break;
        }
        case 'disconnect': {
          await sessionService.disconnect(session.id);
          onStatusChange(session.id, 'DISCONNECTED');
          break;
        }
        case 'reconnect': {
          await sessionService.reconnect(session.id);
          onStatusChange(session.id, 'CONNECTING');
          break;
        }
        case 'logout': {
          await sessionService.logout(session.id);
          onStatusChange(session.id, 'LOGGED_OUT');
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocorreu um erro');
    } finally {
      setLoadingAction(null);
    }
  }

  const isBusy = loadingAction !== null;
  const status = session.status;

  return (
    <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="h6" fontWeight={600} noWrap>
            {session.name}
          </Typography>
          <SessionStatusChip status={status} />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Chip label={session.engine} size="small" variant="outlined" color="default" />
          {session.phone && (
            <Typography variant="caption" color="text.secondary">
              {session.phone}
            </Typography>
          )}
        </Box>

        {error && (
          <Typography variant="caption" color="error" display="block" mt={1}>
            {error}
          </Typography>
        )}
      </CardContent>

      <Divider />

      <CardActions sx={{ justifyContent: 'space-between', px: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {/* Conectar */}
          {(status === 'PENDING' || status === 'DISCONNECTED' || status === 'FAILED') && (
            <Tooltip title="Conectar">
              <span>
                <IconButton
                  size="small"
                  color="primary"
                  onClick={() => handle('connect')}
                  disabled={isBusy}
                >
                  {loadingAction === 'connect' ? <CircularProgress size={18} /> : <LinkIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
          )}

          {/* Reconectar */}
          {(status === 'DISCONNECTED' || status === 'FAILED') && (
            <Tooltip title="Reconectar">
              <span>
                <IconButton
                  size="small"
                  onClick={() => handle('reconnect')}
                  disabled={isBusy}
                >
                  {loadingAction === 'reconnect' ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
          )}

          {/* Desconectar */}
          {(status === 'CONNECTED' || status === 'CONNECTING' || status === 'AWAITING_QR' || status === 'AWAITING_PAIRING') && (
            <Tooltip title="Desconectar">
              <span>
                <IconButton
                  size="small"
                  color="warning"
                  onClick={() => handle('disconnect')}
                  disabled={isBusy}
                >
                  {loadingAction === 'disconnect' ? <CircularProgress size={18} /> : <LinkOffIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
          )}

          {/* Logout */}
          {status !== 'PENDING' && status !== 'LOGGED_OUT' && (
            <Tooltip title="Logout (desautenticar WhatsApp)">
              <span>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => handle('logout')}
                  disabled={isBusy}
                >
                  {loadingAction === 'logout' ? <CircularProgress size={18} /> : <LogoutIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>

        {/* Ver QR */}
        {(status === 'CONNECTING' || status === 'AWAITING_QR' || status === 'AWAITING_PAIRING') && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<QrCodeIcon />}
            onClick={() => onRequestQr(session)}
          >
            QR Code
          </Button>
        )}
      </CardActions>
    </Card>
  );
}
