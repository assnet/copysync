import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Grid,
  CircularProgress,
  Alert,
  Snackbar,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { sessionService } from '@/services/session.service';
import { SessionCard } from '@/features/sessions/components/SessionCard';
import { CreateSessionDialog } from '@/features/sessions/components/CreateSessionDialog';
import { QrCodeDialog } from '@/features/sessions/components/QrCodeDialog';
import type { SessionItem, SessionStatus } from '@/types/api.types';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [qrSession, setQrSession] = useState<SessionItem | null>(null);

  const [toast, setToast] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      setError(null);
      const data = await sessionService.list();
      setSessions(data.sessions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar sessões');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  function handleStatusChange(sessionId: string, status: SessionStatus) {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, status } : s))
    );
    // Atualiza também a sessão selecionada no QR dialog
    setQrSession((prev) => (prev?.id === sessionId ? { ...prev, status } : prev));
  }

  async function handleCreated() {
    setCreateOpen(false);
    setToast({ message: 'Sessão criada com sucesso!', severity: 'success' });
    await loadSessions();
  }

  function handleDeleted(sessionId: string) {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setToast({ message: 'Sessão deletada.', severity: 'success' });
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Sessões
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Gerencie as conexões de WhatsApp do seu tenant.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
        >
          Nova Sessão
        </Button>
      </Box>

      {/* Erro de carregamento */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Loading */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Lista */}
      {!loading && sessions.length === 0 && (
        <Box
          sx={{
            textAlign: 'center',
            py: 10,
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 3,
          }}
        >
          <Typography variant="h6" color="text.secondary" gutterBottom>
            Nenhuma sessão criada ainda
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            Crie uma sessão para conectar um número de WhatsApp.
          </Typography>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            Criar primeira sessão
          </Button>
        </Box>
      )}

      {!loading && sessions.length > 0 && (
        <Grid container spacing={2}>
          {sessions.map((session) => (
            <Grid key={session.id} item xs={12} sm={6} md={4} lg={3}>
              <SessionCard
                session={session}
                onRequestQr={setQrSession}
                onStatusChange={handleStatusChange}
                onDeleted={handleDeleted}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Modal criar sessão */}
      <CreateSessionDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />

      {/* Modal QR Code */}
      <QrCodeDialog
        session={qrSession}
        open={Boolean(qrSession)}
        onClose={() => setQrSession(null)}
        onStatusChange={handleStatusChange}
      />

      {/* Toast feedback */}
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)} sx={{ width: '100%' }}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
