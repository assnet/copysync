import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog, DialogContent, DialogActions, Button, Box,
  Typography, CircularProgress, Alert, IconButton, Tooltip,
  Divider, alpha, useTheme,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloseIcon from '@mui/icons-material/Close';
import { QRCodeSVG } from 'qrcode.react';
import { sessionService } from '@/services/session.service';
import { SessionStatusChip } from './SessionStatusChip';
import type { SessionItem, SessionStatus } from '@/types/api.types';

interface Props {
  session: SessionItem | null;
  open: boolean;
  onClose: () => void;
  onStatusChange?: (sessionId: string, status: SessionStatus) => void;
}

const POLLING_INTERVAL_MS = 4000;

export function QrCodeDialog({ session, open, onClose, onStatusChange }: Props) {
  const theme = useTheme();
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const statusRef = useRef<SessionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { statusRef.current = status; }, [status]);

  const fetchState = useCallback(async () => {
    if (!session) return;
    try {
      const [statusRes, qrRes] = await Promise.all([
        sessionService.getStatus(session.id),
        sessionService.getQr(session.id),
      ]);
      setStatus(statusRes.status);
      setQrCode(qrRes.qrCode);
      onStatusChange?.(session.id, statusRes.status);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao buscar estado');
    }
  }, [session, onStatusChange]);

  const fetchStateRef = useRef(fetchState);
  useEffect(() => { fetchStateRef.current = fetchState; }, [fetchState]);

  useEffect(() => {
    if (!open || !session?.id) return;
    setLoading(true);
    fetchStateRef.current().finally(() => setLoading(false));
    const interval = setInterval(async () => {
      const s = statusRef.current;
      if (s === 'CONNECTED' || s === 'FAILED' || s === 'LOGGED_OUT') {
        clearInterval(interval);
        return;
      }
      await fetchStateRef.current();
    }, POLLING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [open, session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) { setQrCode(null); setStatus(null); setError(null); }
  }, [open]);

  const isWaiting = status === 'CONNECTING' || status === 'AWAITING_QR' || status === 'AWAITING_PAIRING';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      {/* Cabeçalho customizado */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2.5,
          pt: 2.5,
          pb: 1.5,
        }}
      >
        <Box>
          <Typography variant="h6" fontWeight={700}>
            {session?.name ?? 'QR Code'}
          </Typography>
          <Box sx={{ mt: 0.5 }}>
            {status ? (
              <SessionStatusChip status={status} />
            ) : (
              <Typography variant="caption" color="text.secondary">Carregando…</Typography>
            )}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="Atualizar manualmente">
            <span>
              <IconButton
                size="small"
                onClick={fetchState}
                disabled={loading}
              >
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      <Divider />

      <DialogContent sx={{ px: 2.5, py: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {status === 'CONNECTED' && (
          <Alert severity="success" sx={{ mb: 1 }}>
            Sessão conectada com sucesso!
          </Alert>
        )}

        {status === 'LOGGED_OUT' && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            A conexão com o WhatsApp foi desfeita no celular. Clique em Reconectar para
            gerar um novo QR Code — o histórico desta sessão é preservado.
          </Alert>
        )}

        {status === 'FAILED' && (
          <Alert severity="error" sx={{ mb: 1 }}>
            A sessão encontrou um erro ou foi desconectada. Tente reconectar.
          </Alert>
        )}

        {(status === 'PENDING' || status === 'DISCONNECTED') && (
          <Alert severity="info" sx={{ mb: 1 }}>
            Clique em "Conectar" na lista de sessões para iniciar a conexão.
          </Alert>
        )}

        {isWaiting && (
          <Box sx={{ textAlign: 'center' }}>
            {loading && !qrCode ? (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  py: 4,
                }}
              >
                <CircularProgress size={44} />
                <Typography variant="body2" color="text.secondary">
                  Aguardando QR code…
                </Typography>
              </Box>
            ) : qrCode ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  Abra o WhatsApp e escaneie o código abaixo
                </Typography>

                {/* QR frame */}
                <Box
                  sx={{
                    p: 2.5,
                    borderRadius: 3,
                    border: '2px solid',
                    borderColor: alpha(theme.palette.primary.main, 0.4),
                    bgcolor: '#fff',
                    display: 'inline-flex',
                    boxShadow: `0 0 0 6px ${alpha(theme.palette.primary.main, 0.06)}`,
                  }}
                >
                  <QRCodeSVG
                    value={qrCode}
                    size={220}
                    level="M"
                    fgColor="#0f1117"
                    bgColor="#ffffff"
                  />
                </Box>

                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.75,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: 2,
                    bgcolor: 'action.hover',
                  }}
                >
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      bgcolor: 'warning.main',
                      animation: 'pulse 1.5s ease-in-out infinite',
                      '@keyframes pulse': {
                        '0%, 100%': { opacity: 1 },
                        '50%': { opacity: 0.3 },
                      },
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Atualizando a cada {POLLING_INTERVAL_MS / 1000}s
                  </Typography>
                </Box>
              </Box>
            ) : null}
          </Box>
        )}
      </DialogContent>

      <Divider />

      <DialogActions sx={{ px: 2.5, py: 1.5 }}>
        <Button onClick={onClose} fullWidth variant="outlined">
          Fechar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

