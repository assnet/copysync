import { useMemo, useState } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Alert, Box, Button, CircularProgress, Stack, Step, StepLabel, Stepper, Typography } from '@mui/material';
import { ArrowLeft, ArrowRight, Save } from 'lucide-react';
import { AppIcon, SectionCard } from '@/components';
import type { OfferConfigGroup, OfferConfigResponse, OfferConfigSettings, OfferDispatchOrder, SaveOfferConfigRequest, SessionItem } from '@/types/api.types';
import { offerStrings } from '../../strings';
import { DEFAULT_INTERVAL, intervalValid } from '../../utils/offerConfig';
import type { OfferErrorView } from '../../utils/offerErrors';
import { ConfigSessionStep } from './ConfigSessionStep';
import { ConfigGroupsStep, type SelectedGroup } from './ConfigGroupsStep';
import { ConfigConfirmStep } from './ConfigConfirmStep';

const t = offerStrings.wizard;

interface WizardDraft {
  step: number;
  sessionIds: string[];
  selected: [string, SelectedGroup][];
  intervalMin: number;
  intervalMax: number;
  dispatchOrder: OfferDispatchOrder;
}

interface Props {
  config: OfferConfigSettings | null;
  groups: OfferConfigGroup[];
  groupLimit: number | null;
  sessionLimit: number | null;
  sessions: SessionItem[];
  sessionsLoading: boolean;
  sessionsFailed: boolean;
  onRetrySessions: () => void;
  onSave: (body: SaveOfferConfigRequest) => Promise<OfferConfigResponse>;
  onSaved: () => void;
  /** Ausente = primeira configuração, sem como cancelar. */
  onCancel?: () => void;
}

/** Assistente Sessões → Grupos → Confirmar. Abre preenchido com a configuração atual ao editar. */
export function OfferConfigWizard({
  config, groups, groupLimit, sessionLimit, sessions, sessionsLoading, sessionsFailed, onRetrySessions, onSave, onSaved, onCancel,
}: Props) {
  const connected = useMemo(() => sessions.filter((s) => s.status === 'CONNECTED'), [sessions]);
  // Todo o rascunho do assistente sobrevive a reload (passo, sessões, grupos, intervalo, ordem);
  // some ao salvar ou cancelar. Começa da configuração salva quando não há rascunho.
  const [draft, setDraft, clearDraft] = usePersistedState<WizardDraft>('offers.wizard', () => ({
    step: 0,
    sessionIds: config?.sessionIds ?? [],
    selected: groups
      .filter((g): g is OfferConfigGroup & { sessionId: string } => g.sessionId != null && (config?.sessionIds ?? []).includes(g.sessionId))
      .map((g) => [g.conversationId, { title: g.title, avatarUrl: g.avatarUrl, sessionId: g.sessionId }]),
    intervalMin: config?.intervalMinSeconds ?? DEFAULT_INTERVAL.min,
    intervalMax: config?.intervalMaxSeconds ?? DEFAULT_INTERVAL.max,
    dispatchOrder: config?.dispatchOrder ?? 'SEQUENTIAL',
  }), { version: 1 });
  const { step, sessionIds, intervalMin, intervalMax, dispatchOrder } = draft;
  const selected = useMemo(() => new Map(draft.selected), [draft.selected]);
  const setStep = (fn: (s: number) => number) => setDraft((d) => ({ ...d, step: fn(d.step) }));
  const setSessionIds = (fn: (ids: string[]) => string[]) => setDraft((d) => ({ ...d, sessionIds: fn(d.sessionIds) }));
  const setSelected = (fn: (m: Map<string, SelectedGroup>) => Map<string, SelectedGroup>) =>
    setDraft((d) => ({ ...d, selected: [...fn(new Map(d.selected))] }));
  const setIntervalMin = (v: number) => setDraft((d) => ({ ...d, intervalMin: v }));
  const setIntervalMax = (v: number) => setDraft((d) => ({ ...d, intervalMax: v }));
  const setDispatchOrder = (v: OfferDispatchOrder) => setDraft((d) => ({ ...d, dispatchOrder: v }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sessões escolhidas que seguem conectadas, na ordem de escolha (sessão que caiu sai do envio)
  const chosen = useMemo(
    () => sessionIds.flatMap((id) => connected.find((s) => s.id === id) ?? []),
    [sessionIds, connected],
  );
  const overGroupLimit = groupLimit != null && selected.size > groupLimit;
  const overSessionLimit = sessionLimit != null && chosen.length > sessionLimit;

  const canNext = step === 0
    ? chosen.length > 0 && !overSessionLimit
    : step === 1 ? selected.size > 0 && !overGroupLimit : false;
  const canSave = chosen.length > 0 && !overSessionLimit && selected.size > 0 && !overGroupLimit && intervalValid(intervalMin, intervalMax);

  const toggleSession = (id: string) => {
    setSessionIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (sessionLimit != null && prev.length >= sessionLimit) return prev;
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
      else if (groupLimit == null || next.size < groupLimit) next.set(id, group);
      return next;
    });
    setError(null);
  };

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
      });
      clearDraft();
      onSaved();
    } catch (err) {
      setError((err as OfferErrorView).message ?? offerStrings.errors.generic);
    } finally {
      setSaving(false);
    }
  };

  const heading = [t.session, t.groups, t.confirm][step];

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
        {step === 0 && (
          <ConfigSessionStep
            sessions={connected}
            loading={sessionsLoading}
            failed={sessionsFailed}
            selectedIds={chosen.map((s) => s.id)}
            limit={sessionLimit}
            onToggle={toggleSession}
            onRetry={onRetrySessions}
          />
        )}
        {step === 1 && (
          <ConfigGroupsStep
            sessions={chosen}
            selected={selected}
            limit={groupLimit}
            onToggle={toggleGroup}
            onClear={() => setSelected(() => new Map())}
          />
        )}
        {step === 2 && (
          <ConfigConfirmStep
            sessions={chosen}
            groups={[...selected.values()]}
            intervalMin={intervalMin}
            intervalMax={intervalMax}
            onInterval={(min, max) => { setIntervalMin(min); setIntervalMax(max); }}
            dispatchOrder={dispatchOrder}
            onDispatchOrder={setDispatchOrder}
          />
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>{error}</Alert>}

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
        {step < 2 ? (
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
