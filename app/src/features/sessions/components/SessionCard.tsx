import { useState } from 'react';
import {
  Card, CardContent, CardActions, Box, Typography, Avatar, IconButton, Tooltip,
  CircularProgress, Chip, Dialog, DialogTitle, DialogContent,
  DialogContentText, DialogActions, Button, alpha, useTheme, Divider,
} from '@mui/material';
import QrCodeIcon from '@mui/icons-material/QrCode2';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import RefreshIcon from '@mui/icons-material/Refresh';
import LogoutIcon from '@mui/icons-material/Logout';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PhoneIcon from '@mui/icons-material/PhoneIphone';
import WarningIcon from '@mui/icons-material/WarningAmberRounded';
import { sessionService } from '@/services/session.service';
import { SessionStatusChip } from './SessionStatusChip';
import type { SessionItem, SessionStatus } from '@/types/api.types';
import { sessionStrings } from '../strings';
import { formatBrazilPhone } from '../utils';

const t = sessionStrings.card;

interface Props {
  session: SessionItem;
  onRequestQr: (session: SessionItem) => void;
  onStatusChange: (sessionId: string, status: SessionStatus) => void;
  onDeleted: (sessionId: string) => void;
}

type Action = 'connect' | 'disconnect' | 'reconnect' | 'logout';

// Cor do dot de status
function statusDotColor(status: SessionStatus): string {
  if (status === 'CONNECTED') return 'success.main';
  if (status === 'CONNECTING' || status === 'AWAITING_QR' || status === 'AWAITING_PAIRING') return 'warning.main';
  if (status === 'FAILED' || status === 'LOGGED_OUT') return 'error.main';
  return 'text.disabled';
}

export function SessionCard({ session, onRequestQr, onStatusChange, onDeleted }: Props) {
  const theme = useTheme();
  const [loadingAction, setLoadingAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isBusy = loadingAction !== null || deleting;
  const { status } = session;

  async function handle(action: Action) {
    setLoadingAction(action);
    setError(null);
    try {
      switch (action) {
        case 'connect': {
          const res = await sessionService.connect(session.id);
          onStatusChange(session.id, res.status);
          onRequestQr({ ...session, status: res.status }); // abre o dialog de QR com status atualizado
          break;
        }
        case 'disconnect': {
          await sessionService.disconnect(session.id);
          onStatusChange(session.id, 'DISCONNECTED');
          break;
        }
        case 'reconnect': {
          const res = await sessionService.reconnect(session.id);
          onStatusChange(session.id, res.status);
          // Sempre abre o QR: se as credenciais ainda valem a sessão conecta sozinha e o
          // dialog só mostra o progresso; se foram revogadas, o QR é o único caminho de volta.
          // Em ambos os casos é a MESMA sessão — histórico e mídia preservados.
          onRequestQr({ ...session, status: res.status });
          break;
        }
        case 'logout': {
          await sessionService.logout(session.id);
          onStatusChange(session.id, 'LOGGED_OUT');
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.genericError);
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setConfirmDelete(false);
    try {
      await sessionService.delete(session.id);
      onDeleted(session.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.deleteError);
      setDeleting(false);
    }
  }

  const isActive = status === 'CONNECTED' || status === 'CONNECTING' || status === 'AWAITING_QR' || status === 'AWAITING_PAIRING';

  return (
    <>
      <Card
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
          '&:hover': {
            borderColor: alpha(theme.palette.primary.main, 0.35),
            boxShadow: `0 4px 20px ${alpha(theme.palette.primary.main, 0.08)}`,
          },
        }}
      >
        <CardContent sx={{ flex: 1, pb: 1.5 }}>
          {/* Topo: nome + status dot */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.5 }}>
            <Box sx={{ position: 'relative', flexShrink: 0 }}>
              <Avatar
                src={session.avatarUrl ?? undefined}
                variant="rounded"
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 2.5,
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                  color: 'primary.main',
                  fontWeight: 800,
                  fontSize: 16,
                }}
              >
                {session.name[0]?.toUpperCase() ?? '?'}
              </Avatar>
              {/* Dot de status */}
              <Box
                sx={{
                  position: 'absolute',
                  bottom: -2,
                  right: -2,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  bgcolor: statusDotColor(status),
                  border: '2px solid',
                  borderColor: 'background.paper',
                }}
              />
            </Box>

            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" noWrap title={session.name}>
                {session.name}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                <SessionStatusChip status={status} />
                {session.phoneMismatch && (
                  <Tooltip title={t.mismatchTooltip(formatBrazilPhone(session.declaredPhone))}>
                    <Chip
                      size="small"
                      color="warning"
                      variant="outlined"
                      icon={<WarningIcon />}
                      label={t.mismatchChip}
                    />
                  </Tooltip>
                )}
              </Box>
            </Box>
          </Box>

          {/* Info */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {session.phone && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <PhoneIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                <Typography variant="caption" color="text.secondary">
                  {formatBrazilPhone(session.phone)}
                </Typography>
              </Box>
            )}
            {session.updatedAt && (
              <Typography variant="caption" color="text.disabled">
                {t.updatedAt(new Date(session.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))}
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

        <CardActions sx={{ px: 1.5, py: 1, justifyContent: 'space-between' }}>
          {/* Ações principais */}
          <Box sx={{ display: 'flex', gap: 0.25 }}>
            {status === 'PENDING' && (
              <Tooltip title={t.connect}>
                <span>
                  <IconButton size="small" color="primary" onClick={() => handle('connect')} disabled={isBusy}>
                    {loadingAction === 'connect' ? <CircularProgress size={16} /> : <LinkIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {(status === 'DISCONNECTED' || status === 'FAILED' || status === 'LOGGED_OUT') && (
              <Tooltip title={t.reconnect}>
                <span>
                  <IconButton size="small" onClick={() => handle('reconnect')} disabled={isBusy}>
                    {loadingAction === 'reconnect' ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {isActive && (
              <Tooltip title={t.disconnect}>
                <span>
                  <IconButton size="small" color="warning" onClick={() => handle('disconnect')} disabled={isBusy}>
                    {loadingAction === 'disconnect' ? <CircularProgress size={16} /> : <LinkOffIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {status !== 'PENDING' && status !== 'LOGGED_OUT' && (
              <Tooltip title={t.logout}>
                <span>
                  <IconButton size="small" color="error" onClick={() => handle('logout')} disabled={isBusy}>
                    {loadingAction === 'logout' ? <CircularProgress size={16} /> : <LogoutIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Box>

          {/* QR e delete */}
          <Box sx={{ display: 'flex', gap: 0.25, alignItems: 'center' }}>
            {(status === 'CONNECTING' || status === 'AWAITING_QR' || status === 'AWAITING_PAIRING') && (
              <Tooltip title={t.showConnection}>
                <span>
                  <IconButton size="small" color="primary" onClick={() => onRequestQr(session)} disabled={isBusy}>
                    <QrCodeIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            <Tooltip title={t.delete}>
              <span>
                <IconButton
                  size="small"
                  sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                  onClick={() => setConfirmDelete(true)}
                  disabled={isBusy}
                >
                  {deleting ? <CircularProgress size={16} color="error" /> : <DeleteOutlineIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </CardActions>
      </Card>

      {/* Confirm delete */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t.deleteTitle}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t.deleteMessage(session.name)}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>{t.cancel}</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>
            {t.confirmDelete}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

