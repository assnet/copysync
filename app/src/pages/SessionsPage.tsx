import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Button, Grid, CircularProgress, Alert, Snackbar, Typography } from '@mui/material';
import { MonitorSmartphone, Plus } from 'lucide-react';
import { sessionService } from '@/services/session.service';
import { SessionCard } from '@/features/sessions/components/SessionCard';
import { CreateSessionWizard } from '@/features/sessions/components/CreateSessionWizard';
import { CreateTelegramSessionWizard } from '@/features/sessions/components/CreateTelegramSessionWizard';
import { ConnectSessionDialog } from '@/features/sessions/components/ConnectSessionDialog';
import { ChannelPickerDialog } from '@/features/sessions/components/ChannelPickerDialog';
import { SessionLimitsChips } from '@/features/sessions/components/SessionLimitsChips';
import { CHANNEL_ICON, channelLabel } from '@/features/sessions/components/SessionChannelChip';
import { PlanLimitBanner } from '@/features/linkRotation/components/PlanLimitBanner';
import type { PlanLimitKind } from '@/features/linkRotation/planUpsell';
import { sessionStrings } from '@/features/sessions/strings';
import { channelOf, safeReturnPath, withSessionId, type SessionChannel } from '@/features/sessions/utils';
import { usePersistedState } from '@/hooks/usePersistedState';
import { PageHeader, EmptyState, AppIcon } from '@/components';
import type { SessionItem, SessionLimitsResponse, SessionStatus } from '@/types/api.types';

const t = sessionStrings.page;
const CHANNELS: readonly SessionChannel[] = ['whatsapp', 'telegram'];
const LIMIT_KIND: Record<SessionChannel, PlanLimitKind> = { whatsapp: 'whatsappSessions', telegram: 'telegramSessions' };

/**
 * `?create=whatsapp|telegram` abre direto o assistente do canal; `?create=1` (telas de
 * monitoramento/rodízio, que aceitam os dois canais) abre o seletor de canal primeiro.
 */
function channelFromParam(value: string | null): SessionChannel | 'pick' | null {
  if (value === 'whatsapp' || value === 'telegram') return value;
  if (value === '1') return 'pick';
  return null;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [limits, setLimits] = useState<SessionLimitsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // `?create=1&returnTo=/tela`: outra tela pediu uma sessão nova e quer voltar com ela
  const returnToRef = useRef(safeReturnPath(searchParams.get('returnTo')));
  const createdRef = useRef<SessionItem | null>(null);
  // Assistente aberto (e de qual canal) sobrevive a reload; o passo fica no próprio assistente.
  // Inicial sempre `null`: `clear()` volta ao inicial, e a URL só abre o assistente uma vez (efeito abaixo).
  const [createChannel, setCreateChannel, clearCreateChannel] = usePersistedState<SessionChannel | null>(
    'sessions.createChannel',
    null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [planLimit, setPlanLimit] = useState<{ kind: PlanLimitKind; limit: number } | null>(null);
  const [qrSession, setQrSession] = useState<SessionItem | null>(null);
  const [toast, setToast] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  const loadLimits = useCallback(async () => {
    try {
      setLimits(await sessionService.limits());
    } catch {
      setLimits(null); // sem limites o seletor não bloqueia; a API ainda recusa com PLAN_LIMIT_REACHED
    }
  }, []);

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

  useEffect(() => { void loadSessions(); void loadLimits(); }, [loadSessions, loadLimits]);

  // Tira `create`/`returnTo` da URL: recarregar a página não reabre o assistente pela URL
  useEffect(() => {
    if (!searchParams.has('create') && !searchParams.has('returnTo')) return;
    const fromUrl = channelFromParam(searchParams.get('create'));
    if (fromUrl === 'pick') setPickerOpen(true);
    else if (fromUrl) setCreateChannel(fromUrl);
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
    await Promise.all([loadSessions(), loadLimits()]);
  }

  // Com `returnTo`, fechar o assistente volta para a tela de origem (com a sessão criada, se houver)
  function handleWizardClose() {
    clearCreateChannel();
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
    void loadLimits();
  }

  function handleDeleted(sessionId: string) {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setToast({ message: t.deleted, severity: 'success' });
    void loadLimits();
  }

  function openPlanLimit(channel: SessionChannel, limit: number) {
    setPickerOpen(false);
    setPlanLimit({ kind: LIMIT_KIND[channel], limit });
  }

  const newSessionButton = (label: string) => (
    <Button variant="contained" startIcon={<AppIcon icon={Plus} />} onClick={() => setPickerOpen(true)}>
      {label}
    </Button>
  );

  const groups = CHANNELS
    .map((channel) => ({ channel, items: sessions.filter((s) => channelOf(s.engine) === channel) }))
    .filter((g) => g.items.length > 0);
  const showSectionHeaders = groups.length > 1;

  const wizardProps = {
    onClose: handleWizardClose,
    onCreated: (session: SessionItem) => void handleCreated(session),
    onStatusChange: handleStatusChange,
  };

  return (
    <Box>
      <PageHeader title={t.title} subtitle={t.subtitle} action={newSessionButton(t.newSession)} />

      {limits && <Box sx={{ mb: 3, mt: -1 }}><SessionLimitsChips limits={limits} /></Box>}

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
          icon={<AppIcon icon={MonitorSmartphone} size="lg" />}
          title={t.emptyTitle}
          description={t.emptyDescription}
          action={newSessionButton(t.emptyAction)}
        />
      )}

      {!loading && groups.map(({ channel, items }) => (
        <Box key={channel} component="section" aria-label={sessionStrings.channel.sectionAria(channelLabel(channel))} sx={{ mb: 3 }}>
          {showSectionHeaders && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, color: 'text.secondary' }}>
              <AppIcon icon={CHANNEL_ICON[channel]} />
              <Typography variant="subtitle2" component="h2" color="text.primary">{channelLabel(channel)}</Typography>
              <Typography variant="caption">{items.length}</Typography>
            </Box>
          )}
          <Grid container spacing={2.5}>
            {items.map((session) => (
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
        </Box>
      ))}

      <ChannelPickerDialog
        open={pickerOpen}
        // Com `returnTo`, desistir no seletor volta para a tela de origem, como fechar o assistente
        onClose={() => { setPickerOpen(false); if (returnToRef.current) handleWizardClose(); }}
        limits={limits}
        onPick={(channel) => { setPickerOpen(false); setCreateChannel(channel); }}
        onAtLimit={openPlanLimit}
      />
      <CreateSessionWizard
        open={createChannel === 'whatsapp'}
        onPlanLimit={(limit) => setPlanLimit({ kind: 'whatsappSessions', limit })}
        {...wizardProps}
      />
      <CreateTelegramSessionWizard
        open={createChannel === 'telegram'}
        onPlanLimit={(limit) => setPlanLimit({ kind: 'telegramSessions', limit })}
        {...wizardProps}
      />
      <ConnectSessionDialog
        session={qrSession}
        open={Boolean(qrSession)}
        onClose={() => { setQrSession(null); void loadSessions(); }}
        onStatusChange={handleStatusChange}
      />
      {planLimit && (
        <PlanLimitBanner open onClose={() => setPlanLimit(null)} kind={planLimit.kind} limit={planLimit.limit} />
      )}

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
