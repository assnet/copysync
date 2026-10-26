import { useState, useEffect, useCallback } from 'react';
import { Box, Button, Grid, CircularProgress, Alert, Snackbar } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DevicesIcon from '@mui/icons-material/Devices';
import { sessionService } from '@/services/session.service';
import { SessionCard } from '@/features/sessions/components/SessionCard';
import { CreateSessionWizard } from '@/features/sessions/components/CreateSessionWizard';
import { ConnectSessionDialog } from '@/features/sessions/components/ConnectSessionDialog';
import { sessionStrings } from '@/features/sessions/strings';
import { PageHeader, EmptyState } from '@/components';
import type { SessionItem, SessionStatus } from '@/types/api.types';

const t = sessionStrings.page;

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
      setError(err instanceof Error ? err.message : t.loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleStatusChange = useCallback((sessionId: string, status: SessionStatus) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, status } : s)));
    setQrSession((prev) => (prev?.id === sessionId ? { ...prev, status } : prev));
  }, []);

  // O assistente segue aberto para conectar; a lista já mostra a sessão nova.
  async function handleCreated() {
    setToast({ message: t.created, severity: 'success' });
    await loadSessions();
  }

  function handleDeleted(sessionId: string) {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setToast({ message: t.deleted, severity: 'success' });
  }

  return (
    <Box>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            {t.newSession}
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
          title={t.emptyTitle}
          description={t.emptyDescription}
          action={
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
              {t.emptyAction}
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

      <CreateSessionWizard
        open={createOpen}
        onClose={() => { setCreateOpen(false); void loadSessions(); }}
        onCreated={handleCreated}
        onStatusChange={handleStatusChange}
      />
      <ConnectSessionDialog
        session={qrSession}
        open={Boolean(qrSession)}
        onClose={() => { setQrSession(null); void loadSessions(); }}
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

