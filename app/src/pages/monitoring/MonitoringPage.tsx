import { useEffect } from 'react';
import { Alert, Box, Button, Skeleton, Stack, Tooltip } from '@mui/material';
import { Plus } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppIcon, EmptyState, PageHeader } from '@/components';
import { BroadcastGroupsCard } from '@/features/monitoring/components/BroadcastGroupsCard';
import { CapturedOffersList } from '@/features/monitoring/components/CapturedOffersList';
import { GroupPickerDialog, type GroupPickerMode, type PickedGroup } from '@/features/monitoring/components/GroupPickerDialog';
import { MonitoredGroupsCard } from '@/features/monitoring/components/MonitoredGroupsCard';
import { MonitoringSessionSelect } from '@/features/monitoring/components/MonitoringSessionSelect';
import { MonitoringSettingsForm } from '@/features/monitoring/components/MonitoringSettingsForm';
import { SessionSummaryCard } from '@/features/monitoring/components/SessionSummaryCard';
import { useMonitoringConfig } from '@/features/monitoring/hooks/useMonitoringConfig';
import { useMonitoringSessions } from '@/features/monitoring/hooks/useMonitoringSessions';
import { monitoringStrings } from '@/features/monitoring/strings';
import { MonitoringUiError, monitoringErrorMessage, sessionGroupCap } from '@/features/monitoring/utils/apiErrors';
import { MODULE_ICONS } from '@/pages/modules';
import { SendQueuePanel } from '@/features/sendQueue/components/SendQueuePanel';
import { usePersistedState } from '@/hooks/usePersistedState';

const t = monitoringStrings.page;

const PRIVACY = {
  sessionName: 'monitoring.sessionName',
  groupNames: 'monitoring.groupNames',
  groupAvatars: 'monitoring.groupAvatars',
  productText: 'monitoring.capturedText',
} as const;

/** Rota de volta usada pelo assistente de sessões depois de criar uma sessão. */
const CONNECT_NEW_PATH = '/settings/sessions?create=1&returnTo=/monitoring';

const CARDS_GRID = { display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' } } as const;

export function MonitoringPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessionId, setSessionId] = usePersistedState<string | null>('monitoring.sessionId', null);
  const [picker, setPicker] = usePersistedState<GroupPickerMode | null>('monitoring.picker', null);
  const sessions = useMonitoringSessions();
  const selected = sessions.sessions.find((s) => s.id === sessionId) ?? null;
  const cfg = useMonitoringConfig(selected?.id ?? null);
  const config = cfg.config;

  // Volta do assistente de sessões: `?sessionId=` escolhe a sessão nova e sai da URL
  useEffect(() => {
    const fromQuery = searchParams.get('sessionId');
    if (!fromQuery) return;
    setSessionId(fromQuery);
    const next = new URLSearchParams(searchParams);
    next.delete('sessionId');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sessão salva que não existe mais (ou nenhuma escolhida): a primeira conectada, senão a primeira.
  // Saber qual tem monitoramento ligado exigiria buscar a config de cada sessão — não compensa aqui.
  useEffect(() => {
    if (sessions.loading || selected || sessions.sessions.length === 0) return;
    if (searchParams.get('sessionId')) return;
    const first = sessions.sessions.find((s) => s.status === 'CONNECTED') ?? sessions.sessions[0]!;
    setSessionId(first.id);
  }, [sessions.loading, sessions.sessions, selected, searchParams, setSessionId]);

  const connectNew = (
    <Tooltip title={t.connectNewTooltip} arrow describeChild>
      <Button variant="contained" startIcon={<AppIcon icon={Plus} size="sm" />} onClick={() => navigate(CONNECT_NEW_PATH)}>
        {t.connectNew}
      </Button>
    </Tooltip>
  );

  const monitoredCap = config ? sessionGroupCap(config.limits.monitoredGroups, config.usage.monitoredGroups, config.monitoredGroups.length) : null;
  const broadcastCap = config ? sessionGroupCap(config.limits.broadcastGroups, config.usage.broadcastGroups, config.broadcastGroups.length) : null;
  const broadcastSorted = config ? [...config.broadcastGroups].sort((a, b) => a.position - b.position) : [];

  // Nome do grupo citado num erro de conflito: o que está sendo salvo, senão o da configuração
  const titleLookup = (extra: readonly PickedGroup[] = []) => (jid: string) =>
    [...extra, ...(config?.monitoredGroups ?? []), ...(config?.broadcastGroups ?? [])].find((g) => g.groupJid === jid)?.title ?? null;

  const saveMonitored = async (groups: PickedGroup[]) => {
    try {
      await cfg.saveMonitoredGroups(groups.map((g) => ({ groupJid: g.groupJid, keywords: g.keywords })));
    } catch (err) {
      throw new MonitoringUiError(monitoringErrorMessage(err, { scope: 'groups', max: config?.limits.monitoredGroups ?? null, groupTitle: titleLookup(groups) }));
    }
  };

  const sessionNameOf = (id: string) => sessions.sessions.find((s) => s.id === id)?.name ?? null;
  const saveBroadcast = async (groups: { groupJid: string; sessionId: string }[], picked: readonly PickedGroup[] = []) => {
    try {
      await cfg.saveBroadcastGroups(groups);
    } catch (err) {
      throw new MonitoringUiError(monitoringErrorMessage(err, { scope: 'groups', max: config?.limits.broadcastGroups ?? null, groupTitle: titleLookup(picked) }));
    }
  };

  return (
    <Box>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        action={
          sessions.sessions.length > 0 && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <MonitoringSessionSelect sessions={sessions.sessions} value={selected?.id ?? null} onChange={setSessionId} />
              {connectNew}
            </Stack>
          )
        }
      />

      {sessions.loading && sessions.sessions.length === 0 ? (
        <Box sx={CARDS_GRID}>{[0, 1, 2].map((k) => <Skeleton key={k} variant="rounded" height={200} />)}</Box>
      ) : sessions.failed ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void sessions.reload()}>{t.retry}</Button>}>
          {t.sessionsError}
        </Alert>
      ) : sessions.sessions.length === 0 ? (
        <EmptyState
          icon={<AppIcon icon={MODULE_ICONS.monitoring} size="lg" />}
          title={t.emptyTitle}
          description={t.emptyDescription}
          action={connectNew}
        />
      ) : selected ? (
        <Stack spacing={2.5}>
          <Box sx={CARDS_GRID}>
            <SessionSummaryCard session={selected} />
            {config ? (
              <>
                <MonitoredGroupsCard
                  groups={config.monitoredGroups}
                  used={config.usage.monitoredGroups}
                  max={config.limits.monitoredGroups}
                  onConfigure={() => setPicker('monitored')}
                />
                <BroadcastGroupsCard
                  groups={broadcastSorted}
                  used={config.usage.broadcastGroups}
                  max={config.limits.broadcastGroups}
                  monitorSessionId={selected.id}
                  sessionNameOf={sessionNameOf}
                  onAdd={() => setPicker('broadcast')}
                  onChange={(groups) => saveBroadcast(groups)}
                />
              </>
            ) : (
              [0, 1].map((k) => <Skeleton key={k} variant="rounded" height={200} />)
            )}
          </Box>

          {cfg.failed && !config && (
            <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void cfg.reload()}>{t.retry}</Button>}>
              {t.configError}
            </Alert>
          )}

          {config && config.sessionId === selected.id && (
            <MonitoringSettingsForm key={selected.id} sessionId={selected.id} config={config} onSave={cfg.saveSettings} />
          )}

          <CapturedOffersList key={`captured-${selected.id}`} sessionId={selected.id} />
          <SendQueuePanel sessionId={selected.id} privacy={PRIVACY} />

          {config && picker === 'monitored' && (
            <GroupPickerDialog
              mode="monitored"
              sessionId={selected.id}
              initial={config.monitoredGroups.map((g) => ({ groupJid: g.groupJid, sessionId: selected.id, title: g.title, avatarUrl: g.avatarUrl, keywords: g.keywords }))}
              max={monitoredCap}
              excludeJids={config.broadcastGroups.map((g) => g.groupJid)}
              onClose={() => setPicker(null)}
              onSave={saveMonitored}
            />
          )}
          {config && picker === 'broadcast' && (
            <GroupPickerDialog
              mode="broadcast"
              sessionId={selected.id}
              initial={broadcastSorted.map((g) => ({ groupJid: g.groupJid, sessionId: g.sessionId, title: g.title, avatarUrl: g.avatarUrl, keywords: [] }))}
              max={broadcastCap}
              excludeJids={config.monitoredGroups.map((g) => g.groupJid)}
              sessions={sessions.sessions}
              crossSession={config.limits.crossSessionDispatch}
              onClose={() => setPicker(null)}
              onSave={(groups) => saveBroadcast(groups.map((g) => ({ groupJid: g.groupJid, sessionId: g.sessionId })), groups)}
            />
          )}
        </Stack>
      ) : null}
    </Box>
  );
}
