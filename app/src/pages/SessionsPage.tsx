import { useState, useEffect, useCallback } from 'react';
import { Box, Button, Grid, CircularProgress, Alert, Snackbar } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DevicesIcon from '@mui/icons-material/Devices';
import { sessionService } from '@/services/session.service';
import { SessionCard } from '@/features/sessions/components/SessionCard';
import { CreateSessionDialog } from '@/features/sessions/components/CreateSessionDialog';
import { QrCodeDialog } from '@/features/sessions/components/QrCodeDialog';
import { PageHeader, EmptyState } from '@/components';
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

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleStatusChange = useCallback((sessionId: string, status: SessionStatus) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, status } : s)));
    setQrSession((prev) => (prev?.id === sessionId ? { ...prev, status } : prev));
  }, []);

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
      <PageHeader
        title="Sessões"
        subtitle="Gerencie as conexões de WhatsApp do seu tenant."
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            Nova Sessão
          </Button>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && sessions.length === 0 && (
        <EmptyState
          icon={<DevicesIcon />}
          title="Nenhuma sessão criada ainda"
          description="Crie uma sessão para conectar um número de WhatsApp ao seu tenant."
          action={
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
              Criar primeira sessão
            </Button>
          }
        />
      )}

      {!loading && sessions.length > 0 && (
        <Grid container spacing={2.5}>
          {sessions.map((session) => (
            <Grid key={session.id} item xs={12} sm={6} md={4} xl={3}>
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

      <CreateSessionDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
      <QrCodeDialog
        session={qrSession}
        open={Boolean(qrSession)}
        onClose={() => setQrSession(null)}
        onStatusChange={handleStatusChange}
      />

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

