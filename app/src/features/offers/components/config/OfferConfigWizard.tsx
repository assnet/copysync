import { useMemo, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Step, StepLabel, Stepper, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import { SectionCard } from '@/components';
import type { OfferConfigGroup, OfferConfigResponse, OfferConfigSettings, SaveOfferConfigRequest, SessionItem } from '@/types/api.types';
import { offerStrings } from '../../strings';
import { DEFAULT_INTERVAL, intervalValid } from '../../utils/offerConfig';
import type { OfferErrorView } from '../../utils/offerErrors';
import { ConfigSessionStep } from './ConfigSessionStep';
import { ConfigGroupsStep } from './ConfigGroupsStep';
import { ConfigConfirmStep } from './ConfigConfirmStep';
import type { SelectedGroup } from './ConfigGroupsStep';

const t = offerStrings.wizard;

interface Props {
  config: OfferConfigSettings | null;
  groups: OfferConfigGroup[];
  groupLimit: number | null;
  sessions: SessionItem[];
  sessionsLoading: boolean;
  sessionsFailed: boolean;
  onRetrySessions: () => void;
  onSave: (body: SaveOfferConfigRequest) => Promise<OfferConfigResponse>;
  onSaved: () => void;
  /** Ausente = primeira configuração, sem como cancelar. */
  onCancel?: () => void;
}

/** Assistente Sessão → Grupos → Confirmar. Abre preenchido com a configuração atual ao editar. */
export function OfferConfigWizard({
  config, groups, groupLimit, sessions, sessionsLoading, sessionsFailed, onRetrySessions, onSave, onSaved, onCancel,
}: Props) {
  const connected = useMemo(() => sessions.filter((s) => s.status === 'CONNECTED'), [sessions]);
  const [step, setStep] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(config?.sessionId ?? null);
  const [selected, setSelected] = useState<Map<string, SelectedGroup>>(
    () => new Map(groups.filter((g) => g.sessionId == null || g.sessionId === config?.sessionId).map((g) => [g.conversationId, { title: g.title, avatarUrl: g.avatarUrl }])),
  );
  const [intervalMin, setIntervalMin] = useState(config?.intervalMinSeconds ?? DEFAULT_INTERVAL.min);
  const [intervalMax, setIntervalMax] = useState(config?.intervalMaxSeconds ?? DEFAULT_INTERVAL.max);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A sessão salva pode ter caído: só vale se ainda estiver conectada.
  const session = connected.find((s) => s.id === sessionId) ?? null;
  const overLimit = groupLimit != null && selected.size > groupLimit;

  const canNext = step === 0 ? session != null : step === 1 ? selected.size > 0 && !overLimit : false;
  const canSave = session != null && selected.size > 0 && !overLimit && intervalValid(intervalMin, intervalMax);

  const pickSession = (id: string) => {
    if (id !== sessionId) setSelected(new Map());
    setSessionId(id);
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
    if (!session || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        sessionId: session.id,
        intervalMinSeconds: intervalMin,
        intervalMaxSeconds: intervalMax,
        conversationIds: [...selected.keys()],
      });
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
            selectedId={session?.id ?? null}
            onSelect={pickSession}
            onRetry={onRetrySessions}
          />
        )}
        {step === 1 && session && (
          <ConfigGroupsStep
            sessionId={session.id}
            selected={selected}
            limit={groupLimit}
            onToggle={toggleGroup}
            onClear={() => setSelected(new Map())}
          />
        )}
        {step === 2 && session && (
          <ConfigConfirmStep
            sessionName={session.name}
            groups={[...selected.values()]}
            intervalMin={intervalMin}
            intervalMax={intervalMax}
            onInterval={(min, max) => { setIntervalMin(min); setIntervalMax(max); }}
          />
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Stack direction="row" spacing={1.5} sx={{ mt: 3, justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 1 }}>
        <Box>
          {step > 0 ? (
            <Button color="inherit" startIcon={<ArrowBackIcon />} onClick={() => setStep((s) => s - 1)} disabled={saving}>
              {t.back}
            </Button>
          ) : onCancel ? (
            <Button color="inherit" onClick={onCancel}>{t.cancel}</Button>
          ) : null}
        </Box>
        {step < 2 ? (
          <Button variant="contained" disableElevation endIcon={<ArrowForwardIcon />} disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
            {t.next}
          </Button>
        ) : (
          <Button
            variant="contained"
            disableElevation
            startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveOutlinedIcon />}
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
