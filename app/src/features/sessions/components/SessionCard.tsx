import { useState } from 'react';
import {
  Card, CardContent, CardActions, Box, Typography, Avatar, IconButton, Tooltip,
  CircularProgress, Chip, Dialog, DialogTitle, DialogContent,
  DialogContentText, DialogActions, Button, alpha, useTheme, Divider,
} from '@mui/material';
import { Link2, LogOut, Phone, QrCode, RefreshCw, Trash2, TriangleAlert, Unlink } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { sessionService } from '@/services/session.service';
import { SessionStatusChip } from './SessionStatusChip';
import { SessionChannelChip } from './SessionChannelChip';
import type { SessionItem, SessionStatus } from '@/types/api.types';
import { sessionStrings } from '../strings';
import { channelOf, formatInternationalPhone, isAwaitingStatus, isTelegramSession } from '../utils';

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
  if (isAwaitingStatus(status)) return 'warning.main';
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
  const telegram = isTelegramSession(session);
  const blurName = useBlur('sessions.sessionName');
  const blurPhone = useBlur('sessions.sessionPhone');
  const blurAvatar = useBlur('sessions.sessionAvatar');

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

  const isActive = status === 'CONNECTED' || isAwaitingStatus(status);

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
              <Blurred when={blurAvatar} radius={8} sx={{ borderRadius: 2.5 }}>
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
              </Blurred>
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
              <Blurred when={blurName} inline>
                <Typography variant="subtitle2" noWrap title={blurName ? undefined : session.name}>
                  {session.name}
                </Typography>
              </Blurred>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                <SessionChannelChip channel={channelOf(session.engine)} />
                <SessionStatusChip status={status} awaitingCapacity={session.awaitingCapacity} />
                {session.phoneMismatch && (
                  <Tooltip
                    title={(telegram ? t.mismatchTooltipTelegram : t.mismatchTooltip)(
                      formatInternationalPhone(session.declaredPhone),
                    )}
                  >
                    <Chip
                      size="small"
                      color="warning"
                      variant="outlined"
                      icon={<AppIcon icon={TriangleAlert} size="sm" />}
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
                <Box sx={{ display: 'flex', color: 'text.disabled', fontSize: 12 }}>
                  <AppIcon icon={Phone} />
                </Box>
                <Blurred when={blurPhone} inline radius={5}>
                  <Typography variant="caption" color="text.secondary">
                    {formatInternationalPhone(session.phone)}
                  </Typography>
                </Blurred>
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
                    {loadingAction === 'connect' ? <CircularProgress size={16} /> : <AppIcon icon={Link2} size="sm" />}
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {(status === 'DISCONNECTED' || status === 'FAILED' || status === 'LOGGED_OUT') && (
              <Tooltip title={t.reconnect}>
                <span>
                  <IconButton size="small" onClick={() => handle('reconnect')} disabled={isBusy}>
                    {loadingAction === 'reconnect' ? <CircularProgress size={16} /> : <AppIcon icon={RefreshCw} size="sm" />}
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {isActive && (
              <Tooltip title={t.disconnect}>
                <span>
                  <IconButton size="small" color="warning" onClick={() => handle('disconnect')} disabled={isBusy}>
                    {loadingAction === 'disconnect' ? <CircularProgress size={16} /> : <AppIcon icon={Unlink} size="sm" />}
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {status !== 'PENDING' && status !== 'LOGGED_OUT' && (
              <Tooltip title={telegram ? t.logoutTelegram : t.logout}>
                <span>
                  <IconButton size="small" color="error" onClick={() => handle('logout')} disabled={isBusy}>
                    {loadingAction === 'logout' ? <CircularProgress size={16} /> : <AppIcon icon={LogOut} size="sm" />}
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Box>

          {/* QR e delete */}
          <Box sx={{ display: 'flex', gap: 0.25, alignItems: 'center' }}>
            {isAwaitingStatus(status) && (
              <Tooltip title={t.showConnection}>
                <span>
                  <IconButton size="small" color="primary" onClick={() => onRequestQr(session)} disabled={isBusy}>
                    <AppIcon icon={QrCode} size="sm" />
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
                  {deleting ? <CircularProgress size={16} color="error" /> : <AppIcon icon={Trash2} size="sm" />}
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

