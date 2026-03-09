import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  CircularProgress,
  Alert,
  Divider,
  IconButton,
  Tooltip,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
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
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Polling enquanto aguardando QR / conectando
  useEffect(() => {
    if (!open || !session) return;

    setLoading(true);
    fetchState().finally(() => setLoading(false));

    const interval = setInterval(async () => {
      if (status === 'CONNECTED' || status === 'FAILED' || status === 'LOGGED_OUT') return;
      await fetchState();
    }, POLLING_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [open, session]); // eslint-disable-line react-hooks/exhaustive-deps

  const isWaiting = status === 'CONNECTING' || status === 'AWAITING_QR' || status === 'AWAITING_PAIRING';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Box>
          {session?.name ?? 'QR Code'}
          {status && <Box component="span" sx={{ ml: 1.5 }}><SessionStatusChip status={status} /></Box>}
        </Box>
        <Tooltip title="Atualizar">
          <IconButton onClick={fetchState} size="small" disabled={loading}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>

      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {status === 'CONNECTED' && (
          <Alert severity="success">
            Sessão conectada com sucesso! Feche este painel.
          </Alert>
        )}

        {(status === 'FAILED' || status === 'LOGGED_OUT') && (
          <Alert severity="error">
            A sessão encontrou um erro ou foi desconectada. Tente reconectar.
          </Alert>
        )}

        {isWaiting && (
          <Box sx={{ textAlign: 'center', py: 2 }}>
            {loading && !qrCode && (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <CircularProgress size={40} />
                <Typography variant="body2" color="text.secondary">
                  Aguardando QR code…
                </Typography>
              </Box>
            )}

            {qrCode && (
              <>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Escaneie o QR code pelo WhatsApp para conectar a sessão.
                </Typography>
                <Box
                  sx={{
                    display: 'inline-block',
                    p: 2,
                    border: '2px solid',
                    borderColor: 'primary.main',
                    borderRadius: 2,
                    bgcolor: 'white',
                  }}
                >
                  {/* QR como texto base64 — usa a string do Baileys diretamente */}
                  <QrImage value={qrCode} />
                </Box>
                <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                  Atualizando automáticamente a cada {POLLING_INTERVAL_MS / 1000}s
                </Typography>
              </>
            )}
          </Box>
        )}

        {(status === 'PENDING' || status === 'DISCONNECTED') && (
          <Alert severity="info">
            Clique em "Conectar" na lista de sessões para iniciar a conexão.
          </Alert>
        )}
      </DialogContent>

      <Divider />
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── QR image helper ────────────────────────────────────────────────────────────
// O Baileys retorna o QR como string "data:image/png;base64,..." ou como raw string
function QrImage({ value }: { value: string }) {
  const src = value.startsWith('data:') ? value : `data:image/png;base64,${value}`;

  // Se não for imagem base64, renderiza como texto para diagnóstico
  if (!value.startsWith('data:') && value.length < 200) {
    return (
      <Typography
        variant="caption"
        component="pre"
        sx={{ fontFamily: 'monospace', wordBreak: 'break-all', maxWidth: 280 }}
      >
        {value}
      </Typography>
    );
  }

  return (
    <Box
      component="img"
      src={src}
      alt="QR Code"
      sx={{ display: 'block', width: 240, height: 240 }}
    />
  );
}
