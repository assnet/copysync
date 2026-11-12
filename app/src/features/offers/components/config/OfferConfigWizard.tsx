import { AFFILIATE_PLANS_PATH } from '@/features/navigation';
import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Alert, Box, Button, CircularProgress, Stack, Step, StepLabel, Stepper, Typography } from '@mui/material';
import { ArrowLeft, ArrowRight, Save } from 'lucide-react';
import { AppIcon, SectionCard, type PostingWindowValue } from '@/components';
import { PlanLimitBanner } from '@/features/linkRotation/components/PlanLimitBanner';
import type { PlanLimitKind } from '@/features/linkRotation/planUpsell';
import { useBroadcastGroups } from '@/features/broadcastGroups/hooks/useBroadcastGroups';
import { channelOf } from '@/features/sessions/utils';
import type { LimitChannel, OfferConfigGroup, OfferConfigResponse, OfferConfigSettings, OfferDispatchOrder, SaveOfferConfigRequest, SessionItem } from '@/types/api.types';
import { offerStrings } from '../../strings';
import {
  CHANNELS, DEFAULT_INTERVAL, countByChannel, intervalValid, postingWindowFromConfig, postingWindowToRequest, postingWindowValid, unionBroadcastCount,
} from '../../utils/offerConfig';
import type { OfferErrorView } from '../../utils/offerErrors';
import { ConfigSessionStep } from './ConfigSessionStep';
import { ConfigGroupsStep, type SelectedGroup } from './ConfigGroupsStep';
import { ConfigScheduleStep } from './ConfigScheduleStep';
import { ConfigConfirmStep } from './ConfigConfirmStep';

const t = offerStrings.wizard;

interface WizardDraft {
  step: number;
  sessionIds: string[];
  selected: [string, SelectedGroup][];
  intervalMin: number;
  intervalMax: number;
  dispatchOrder: OfferDispatchOrder;
  postingWindow: PostingWindowValue;
}

interface Props {
  config: OfferConfigSettings | null;
  groups: OfferConfigGroup[];
  /** Limites do plano por canal (sessões e grupos de disparo); null = sem limite. */
  limits: OfferConfigResponse['limits'];
  /** Entitlement `cross_session_dispatch`: sem ele, 2+ sessões do mesmo canal não salvam (403). */
  crossSessionDispatch: boolean;
  sessions: SessionItem[];
  sessionsLoading: boolean;
  sessionsFailed: boolean;
  onRetrySessions: () => void;
  onSave: (body: SaveOfferConfigRequest) => Promise<OfferConfigResponse>;
  onSaved: () => void;
  /** Ausente = primeira configuração, sem como cancelar. */
  onCancel?: () => void;
}

/** Assistente Sessões → Grupos → Horário → Confirmar. Abre preenchido com a configuração atual ao editar. */
export function OfferConfigWizard({
  config, groups, limits, crossSessionDispatch, sessions, sessionsLoading, sessionsFailed, onRetrySessions, onSave, onSaved, onCancel,
}: Props) {
  const connected = useMemo(() => sessions.filter((s) => s.status === 'CONNECTED'), [sessions]);
  // Todo o rascunho do assistente sobrevive a reload (passo, sessões, grupos, horário, intervalo, ordem);
  // some ao salvar ou cancelar. Começa da configuração salva quando não há rascunho.
  const [draft, setDraft, clearDraft] = usePersistedState<WizardDraft>('offers.wizard', () => ({
    step: 0,
    sessionIds: config?.sessionIds ?? [],
    selected: groups
      .filter((g): g is OfferConfigGroup & { sessionId: string } => g.sessionId != null && (config?.sessionIds ?? []).includes(g.sessionId))
      .map((g) => [g.conversationId, { title: g.title, avatarUrl: g.avatarUrl, sessionId: g.sessionId, canPost: g.canPost, postBlockedReason: g.postBlockedReason }]),
    intervalMin: config?.intervalMinSeconds ?? DEFAULT_INTERVAL.min,
    intervalMax: config?.intervalMaxSeconds ?? DEFAULT_INTERVAL.max,
    dispatchOrder: config?.dispatchOrder ?? 'SEQUENTIAL',
    postingWindow: postingWindowFromConfig(config),
  }), { version: 2, scope: 'device' });
  const { step, sessionIds, intervalMin, intervalMax, dispatchOrder, postingWindow } = draft;
  const selected = useMemo(() => new Map(draft.selected), [draft.selected]);
  const setStep = (fn: (s: number) => number) => setDraft((d) => ({ ...d, step: fn(d.step) }));
  const setSessionIds = (fn: (ids: string[]) => string[]) => setDraft((d) => ({ ...d, sessionIds: fn(d.sessionIds) }));
  const setSelected = (fn: (m: Map<string, SelectedGroup>) => Map<string, SelectedGroup>) =>
    setDraft((d) => ({ ...d, selected: [...fn(new Map(d.selected))] }));
  const setIntervalMin = (v: number) => setDraft((d) => ({ ...d, intervalMin: v }));
  const setIntervalMax = (v: number) => setDraft((d) => ({ ...d, intervalMax: v }));
  const setDispatchOrder = (v: OfferDispatchOrder) => setDraft((d) => ({ ...d, dispatchOrder: v }));
  const setPostingWindow = (v: PostingWindowValue) => setDraft((d) => ({ ...d, postingWindow: v }));
  const windowValid = postingWindowValid(postingWindow);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sessões escolhidas que seguem conectadas, na ordem de escolha (sessão que caiu sai do envio)
  const chosen = useMemo(
    () => sessionIds.flatMap((id) => connected.find((s) => s.id === id) ?? []),
    [sessionIds, connected],
  );
  // Canal da sessão = engine; o do grupo = o da sessão dona (limites do plano são por canal)
  const channelOfSession = (id: string): LimitChannel => channelOf(sessions.find((s) => s.id === id)?.engine);
  const sessionCount = countByChannel(chosen.map((s) => channelOf(s.engine)));
  // Grupos de disparo pela união com o monitoramento (catálogo do tenant); sem catálogo, só o rascunho.
  // Buscado só aqui e passado ao passo Grupos (uma requisição por assistente).
  const { data: catalog } = useBroadcastGroups();
  const unionOf = (m: ReadonlyMap<string, SelectedGroup>) =>
    unionBroadcastCount([...m].map(([id, g]) => ({ id, channel: channelOfSession(g.sessionId) })), catalog);
  const groupCount = unionOf(selected);
  const over = (count: Record<LimitChannel, number>, kind: 'sessions' | 'broadcastGroups') =>
    CHANNELS.some((ch) => limits[ch][kind] != null && count[ch] > limits[ch][kind]!);
  const overGroupLimit = over(groupCount, 'broadcastGroups');
  const overSessionLimit = over(sessionCount, 'sessions');
  // Sessão cruzada só é exigida para 2+ sessões do MESMO canal
  const crossLocked = !crossSessionDispatch && CHANNELS.some((ch) => sessionCount[ch] > 1);
  const [planLimit, setPlanLimit] = useState<{ kind: PlanLimitKind; limit: number } | null>(null);

  const canNext = step === 0
    ? chosen.length > 0 && !overSessionLimit && !crossLocked
    : step === 1 ? selected.size > 0 && !overGroupLimit
    : step === 2 ? windowValid : false;
  const canSave = chosen.length > 0 && !overSessionLimit && !crossLocked && selected.size > 0 && !overGroupLimit && intervalValid(intervalMin, intervalMax) && windowValid;

  const toggleSession = (id: string) => {
    setSessionIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      const ch = channelOfSession(id);
      const limit = limits[ch].sessions;
      if (limit != null && prev.filter((x) => channelOfSession(x) === ch).length >= limit) return prev;
      return [...prev, id];
    });
    // Grupos da sessão removida saem da seleção
    if (sessionIds.includes(id)) setSelected((m) => new Map([...m].filter(([, g]) => g.sessionId !== id)));
    setError(null);
  };

  const toggleGroup = (id: string, group: SelectedGroup) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else {
        const ch = channelOfSession(group.sessionId);
        const limit = limits[ch].broadcastGroups;
        // Grupo já em uso (monitoramento ou gerador) não ocupa vaga nova
        const inUse = catalog?.items.some((i) => i.conversationId === id) ?? false;
        if (limit == null || inUse || unionOf(next)[ch] < limit) next.set(id, group);
      }
      return next;
    });
    setError(null);
  };

  // Ordem de envio dentro da sessão: troca com o vizinho da mesma sessão (entre sessões vale `dispatchOrder`)
  const moveGroup = (id: string, delta: -1 | 1) => setDraft((d) => {
    const list = [...d.selected];
    const from = list.findIndex(([gid]) => gid === id);
    if (from < 0) return d;
    const sid = list[from]![1].sessionId;
    let to = from + delta;
    while (to >= 0 && to < list.length && list[to]![1].sessionId !== sid) to += delta;
    if (to < 0 || to >= list.length) return d;
    [list[from], list[to]] = [list[to]!, list[from]!];
    return { ...d, selected: list };
  });

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        sessionIds: chosen.map((s) => s.id),
        intervalMinSeconds: intervalMin,
        intervalMaxSeconds: intervalMax,
        dispatchOrder,
        conversationIds: [...selected.keys()],
        ...postingWindowToRequest(postingWindow),
      });
      clearDraft();
      onSaved();
    } catch (err) {
      const view = err as OfferErrorView;
      setError(view.message ?? offerStrings.errors.generic);
      if (view.planLimit) setPlanLimit(view.planLimit);
    } finally {
      setSaving(false);
    }
  };

  const heading = [t.session, t.groups, t.schedule, t.confirm][step];

  return (
    <SectionCard title={t.title} subtitle={t.subtitle}>
      <Stepper activeStep={step} alternativeLabel sx={{ mb: 3 }}>
        {t.steps.map((label) => (
          <Step key={label}><StepLabel>{label}</StepLabel></Step>
        ))}
      </Stepper>

      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>{heading.title}</Typography>
        <Typography variant="body2" color="text.secondary">{heading.subtitle}</Typography>
      </Box>

      <Box sx={{ minHeight: 160 }}>
        {step === 0 && crossLocked && (
          <Alert severity="info" sx={{ mb: 2 }} action={<Button color="inherit" size="small" component={RouterLink} to={AFFILIATE_PLANS_PATH}>{t.session.crossLockedLink}</Button>}>
            {t.session.crossLocked}
          </Alert>
        )}
        {step === 0 && (
          <ConfigSessionStep
            sessions={connected}
            loading={sessionsLoading}
            failed={sessionsFailed}
            selectedIds={chosen.map((s) => s.id)}
            limits={limits}
            onToggle={toggleSession}
            onRetry={onRetrySessions}
          />
        )}
        {step === 1 && (
          <ConfigGroupsStep
            sessions={chosen}
            selected={selected}
            limits={limits}
            catalog={catalog}
            onToggle={toggleGroup}
            onClear={() => setSelected(() => new Map())}
          />
        )}
        {step === 2 && <ConfigScheduleStep value={postingWindow} onChange={setPostingWindow} disabled={saving} />}
        {step === 3 && (
          <ConfigConfirmStep
            sessions={chosen}
            groups={[...selected.entries()].map(([id, g]) => ({ ...g, id }))}
            onRemoveGroup={(id) => setSelected((m) => { const next = new Map(m); next.delete(id); return next; })}
            onMoveGroup={moveGroup}
            intervalMin={intervalMin}
            intervalMax={intervalMax}
            onInterval={(min, max) => { setIntervalMin(min); setIntervalMax(max); }}
            dispatchOrder={dispatchOrder}
            onDispatchOrder={setDispatchOrder}
            postingWindow={postingWindow}
          />
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {planLimit && <PlanLimitBanner open onClose={() => setPlanLimit(null)} kind={planLimit.kind} limit={planLimit.limit} />}

      <Stack direction="row" spacing={1.5} sx={{ mt: 3, justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 1 }}>
        <Box>
          {step > 0 ? (
            <Button color="inherit" startIcon={<AppIcon icon={ArrowLeft} size="sm" />} onClick={() => setStep((s) => s - 1)} disabled={saving}>
              {t.back}
            </Button>
          ) : onCancel ? (
            <Button color="inherit" onClick={() => { clearDraft(); onCancel(); }}>{t.cancel}</Button>
          ) : null}
        </Box>
        {step < t.steps.length - 1 ? (
          <Button variant="contained" disableElevation endIcon={<AppIcon icon={ArrowRight} size="sm" />} disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
            {t.next}
          </Button>
        ) : (
          <Button
            variant="contained"
            disableElevation
            startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <AppIcon icon={Save} size="sm" />}
            disabled={!canSave || saving}
            onClick={() => void save()}
          >
            {saving ? t.saving : t.save}
          </Button>
        )}
      </Stack>
    </SectionCard>
  );
}
