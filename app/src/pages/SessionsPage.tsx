import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Button, Grid, CircularProgress, Alert, Snackbar } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DevicesIcon from '@mui/icons-material/Devices';
import { sessionService } from '@/services/session.service';
import { SessionCard } from '@/features/sessions/components/SessionCard';
import { CreateSessionWizard } from '@/features/sessions/components/CreateSessionWizard';
import { ConnectSessionDialog } from '@/features/sessions/components/ConnectSessionDialog';
import { sessionStrings } from '@/features/sessions/strings';
import { safeReturnPath, withSessionId } from '@/features/sessions/utils';
import { PageHeader, EmptyState } from '@/components';
import type { SessionItem, SessionStatus } from '@/types/api.types';

const t = sessionStrings.page;

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // `?create=1&returnTo=/tela`: outra tela pediu uma sessão nova e quer voltar com ela
  const returnToRef = useRef(safeReturnPath(searchParams.get('returnTo')));
  const createdRef = useRef<SessionItem | null>(null);
  const [createOpen, setCreateOpen] = useState(() => searchParams.get('create') === '1');
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

  // Tira `create`/`returnTo` da URL: recarregar a página não reabre o assistente
  useEffect(() => {
    if (!searchParams.has('create') && !searchParams.has('returnTo')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('create');
    next.delete('returnTo');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStatusChange = useCallback((sessionId: string, status: SessionStatus) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, status } : s)));
    setQrSession((prev) => (prev?.id === sessionId ? { ...prev, status } : prev));
  }, []);

  // O assistente segue aberto para conectar; a lista já mostra a sessão nova.
  async function handleCreated(session: SessionItem) {
    createdRef.current = session;
    setToast({ message: t.created, severity: 'success' });
    await loadSessions();
  }

  // Com `returnTo`, fechar o assistente volta para a tela de origem (com a sessão criada, se houver)
  function handleWizardClose() {
    setCreateOpen(false);
    const returnTo = returnToRef.current;
    if (returnTo) {
      returnToRef.current = null;
      const created = createdRef.current;
      createdRef.current = null;
      // replace: o Voltar do navegador não reabre o assistente
      navigate(created ? withSessionId(returnTo, created.id) : returnTo, { replace: true });
      return;
    }
    void loadSessions();
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
        onClose={handleWizardClose}
        onCreated={(session) => void handleCreated(session)}
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

