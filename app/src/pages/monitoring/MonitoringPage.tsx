import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Alert, Box, Button, Skeleton, Stack, Tooltip, Typography, useTheme } from '@mui/material';
import { ArrowDown, ArrowRight, Plus, Radar, Send, Smartphone } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppIcon } from '@/components';
import { BroadcastGroupsCard } from '@/features/monitoring/components/BroadcastGroupsCard';
import { CapturedOffersList } from '@/features/monitoring/components/CapturedOffersList';
import { CREDENTIAL_ALERTS_ID, CredentialAlerts } from '@/features/monitoring/components/CredentialAlerts';
import { GroupPickerDialog, type GroupPickerMode, type PickedGroup } from '@/features/monitoring/components/GroupPickerDialog';
import { MonitoredGroupsCard } from '@/features/monitoring/components/MonitoredGroupsCard';
import { MonitoringHero, type MonitoringHeroStep } from '@/features/monitoring/components/MonitoringHero';
import { MonitoringSessionSelect } from '@/features/monitoring/components/MonitoringSessionSelect';
import { MonitoringSettingsForm } from '@/features/monitoring/components/MonitoringSettingsForm';
import { SessionSummaryCard } from '@/features/monitoring/components/SessionSummaryCard';
import { useMonitoringConfig } from '@/features/monitoring/hooks/useMonitoringConfig';
import { useMonitoringSessions } from '@/features/monitoring/hooks/useMonitoringSessions';
import { CARD_RADIUS, VISUALLY_HIDDEN, glassPillSx, iconTileSx, surfaceSx } from '@/features/monitoring/monitoringStyle';
import { monitoringStrings } from '@/features/monitoring/strings';
import { MonitoringUiError, monitoringErrorMessage, sessionGroupCap } from '@/features/monitoring/utils/apiErrors';
import { SendQueuePanel } from '@/features/sendQueue/components/SendQueuePanel';
import { clearPersisted, usePersistedState } from '@/hooks/usePersistedState';

const t = monitoringStrings.page;

const PRIVACY = {
  sessionName: 'monitoring.sessionName',
  groupNames: 'monitoring.groupNames',
  groupAvatars: 'monitoring.groupAvatars',
  productText: 'monitoring.capturedText',
} as const;

/** Rota de volta usada pelo assistente de sessões depois de criar uma sessão. */
const CONNECT_NEW_PATH = '/settings/sessions?create=1&returnTo=/monitoring';

/** Sessão · Escuta · Envia: a sessão é mais estreita; o conector fica no vão entre as duas últimas. */
const CARDS_GRID = { display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, .8fr) minmax(0, 1fr) minmax(0, 1fr)' } } as const;
const SESSIONS_PATH = '/settings/sessions';
const EMPTY_STEP_ICONS = [Smartphone, Radar, Send] as const;
/** Âncora do formulário: o "Ligar" do hero rola até lá e foca a chave "Monitoramento ativo" (1º switch). */
const SETTINGS_ANCHOR_ID = 'monitoring-settings';
const PICKER_MODES: readonly GroupPickerMode[] = ['monitored', 'broadcast'];

/** Rascunho do seletor de grupos de uma sessão (mesmas chaves do GroupPickerDialog). */
function clearPickerDraft(sessionId: string): void {
  for (const mode of PICKER_MODES) {
    clearPersisted(`monitoring.picker.${mode}.${sessionId}`);
    clearPersisted(`monitoring.picker.search.${mode}.${sessionId}`);
    clearPersisted(`monitoring.picker.tab.${mode}.${sessionId}`);
  }
  clearPersisted(`monitoring.picker.openKeywords.${sessionId}`);
}

const prefersReducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

function scrollAndFocus(el: HTMLElement | null, focusTarget: HTMLElement | null = el) {
  el?.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  focusTarget?.focus({ preventScroll: true });
}

/** Seta decorativa origem → destino entre "Grupos monitorados" e "Grupos de disparo". */
function FlowConnector() {
  const theme = useTheme();
  return (
    <Box
      aria-hidden
      sx={{
        ...glassPillSx(theme), position: 'absolute', zIndex: 1, p: 0, width: 32, height: 32, justifyContent: 'center', color: 'primary.main',
        top: { xs: -28, md: '50%' }, left: { xs: '50%', md: -28 }, transform: { xs: 'translateX(-50%)', md: 'translateY(-50%)' },
      }}
    >
      <Box component="span" sx={{ display: { xs: 'inline-flex', md: 'none' } }}><AppIcon icon={ArrowDown} size="sm" /></Box>
      <Box component="span" sx={{ display: { xs: 'none', md: 'inline-flex' } }}><AppIcon icon={ArrowRight} size="sm" /></Box>
    </Box>
  );
}

/** Tenant sem nenhuma sessão: explica o recurso em 3 passos e leva ao assistente. */
function MonitoringEmptyState({ action }: { action: ReactNode }) {
  const theme = useTheme();
  return (
    <Box component="section" aria-labelledby="monitoring-empty-title" sx={{ ...surfaceSx(theme), p: { xs: 2.5, sm: 4 } }}>
      <Typography id="monitoring-empty-title" variant="h6" component="h2" sx={{ fontWeight: 800, letterSpacing: '-0.01em' }}>
        {t.emptyTitle}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 620 }}>{t.emptyDescription}</Typography>
      <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, mt: 3, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' } }}>
        {t.emptySteps.map((step, i) => (
          <Box component="li" key={step.title} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', p: 2, borderRadius: '14px', bgcolor: 'action.hover' }}>
            <Box sx={iconTileSx(theme, i === 2 ? 'success' : i === 1 ? 'info' : 'primary', 40)}>
              <AppIcon icon={EMPTY_STEP_ICONS[i]!} size="md" />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" component="h3" sx={{ fontWeight: 700 }}>{step.title}</Typography>
              <Typography variant="body2" color="text.secondary">{step.body}</Typography>
            </Box>
          </Box>
        ))}
      </Box>
      <Box sx={{ mt: 3 }}>{action}</Box>
    </Box>
  );
}

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

  // Troca de sessão fecha o seletor e descarta o rascunho dele da sessão anterior (senão volta velho)
  const chooseSession = (id: string) => {
    if (id === selected?.id) return;
    if (selected) clearPickerDraft(selected.id);
    setPicker(null);
    setSessionId(id);
  };

  const onHeroAction = (step: MonitoringHeroStep) => {
    if (step === 'session') navigate(SESSIONS_PATH);
    else if (step === 'monitored' || step === 'broadcast') setPicker(step);
    else scrollAndFocus(document.getElementById(CREDENTIAL_ALERTS_ID));
  };

  const onEnable = () => {
    const anchor = document.getElementById(SETTINGS_ANCHOR_ID);
    scrollAndFocus(anchor, anchor?.querySelector<HTMLElement>('input[type="checkbox"]') ?? anchor);
  };

  const heroConfig = config && selected && config.sessionId === selected.id ? config : null;

  return (
    <Box>
      <MonitoringHero
        session={selected}
        config={heroConfig}
        onAction={onHeroAction}
        onEnable={onEnable}
        actions={
          sessions.sessions.length > 0 && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <MonitoringSessionSelect sessions={sessions.sessions} value={selected?.id ?? null} onChange={chooseSession} />
              {connectNew}
            </Stack>
          )
        }
      />

      {sessions.loading && sessions.sessions.length === 0 ? (
        <Box sx={CARDS_GRID} aria-busy="true">
          {[0, 1, 2].map((k) => <Skeleton key={k} variant="rounded" height={220} sx={{ borderRadius: CARD_RADIUS }} />)}
        </Box>
      ) : sessions.failed ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void sessions.reload()}>{t.retry}</Button>}>
          {t.sessionsError}
        </Alert>
      ) : sessions.sessions.length === 0 ? (
        <MonitoringEmptyState
          action={
            <Tooltip title={t.connectNewTooltip} arrow describeChild>
              <Button variant="contained" size="large" startIcon={<AppIcon icon={Plus} size="sm" />} onClick={() => navigate(CONNECT_NEW_PATH)}>
                {t.connectFirst}
              </Button>
            </Tooltip>
          }
        />
      ) : selected ? (
        <Stack spacing={3}>
          {config && <CredentialAlerts alerts={config.credentialAlerts} />}
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
                <Box sx={{ position: 'relative', minWidth: 0 }}>
                  <FlowConnector />
                  <BroadcastGroupsCard
                    groups={broadcastSorted}
                    used={config.usage.broadcastGroups}
                    max={config.limits.broadcastGroups}
                    monitorSessionId={selected.id}
                    sessionNameOf={sessionNameOf}
                    onAdd={() => setPicker('broadcast')}
                    onChange={(groups) => saveBroadcast(groups)}
                  />
                </Box>
              </>
            ) : (
              [0, 1].map((k) => <Skeleton key={k} variant="rounded" height={220} sx={{ borderRadius: CARD_RADIUS }} />)
            )}
          </Box>
          <Typography component="p" sx={VISUALLY_HIDDEN}>{t.flowArrowLabel}</Typography>

          {cfg.failed && !config && (
            <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void cfg.reload()}>{t.retry}</Button>}>
              {t.configError}
            </Alert>
          )}

          {config && config.sessionId === selected.id && (
            <Box id={SETTINGS_ANCHOR_ID} tabIndex={-1} sx={{ scrollMarginTop: 96, '&:focus': { outline: 'none' } }}>
              <MonitoringSettingsForm key={selected.id} sessionId={selected.id} config={config} onSave={cfg.saveSettings} />
            </Box>
          )}

          <CapturedOffersList
            key={`captured-${selected.id}`}
            sessionId={selected.id}
            onConfigureGroups={config && config.monitoredGroups.length === 0 ? () => setPicker('monitored') : undefined}
          />
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
