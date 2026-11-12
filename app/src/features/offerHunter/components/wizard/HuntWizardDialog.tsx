import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Step, StepLabel, Stepper,
  Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { ArrowLeft, ArrowRight, Save, X } from 'lucide-react';
import { AppIcon, ConfirmDialog } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { Hunt, HuntOptions, HuntPreset } from '../../types';
import { offerHunterErrorMessage, offerHunterStrings as t } from '../../strings';
import { useOfferHunts } from '../../hooks';
import {
  WIZARD_STEPS, applyPreset, draftToBody, firstInvalidStep, initialDraft, isDirty, stepOfField, validateStep, wizardDraftKey,
  type FieldErrors, type HuntWizardDraft,
} from './wizardDraft';
import { WizardWhatStep } from './WizardWhatStep';
import { WizardRefineStep } from './WizardRefineStep';
import { WizardWhenStep } from './WizardWhenStep';

const wz = t.wizard;

/**
 * Contrato fixo do assistente de 3 passos (T14). `hunt` presente = edição; ausente = nova caçada.
 * `onSaved` recebe a caçada gravada pela API.
 */
export interface HuntWizardDialogProps {
  open: boolean;
  options: HuntOptions;
  hunt?: Hunt;
  onClose: () => void;
  onSaved: (hunt: Hunt) => void;
}

/**
 * Assistente O que caçar → Refino → Quando e onde. Rascunho por aba (uma chave por caçada em edição),
 * limpo ao salvar ou cancelar. Monta só aberto: a chave do rascunho é lida a cada abertura.
 */
export function HuntWizardDialog(props: HuntWizardDialogProps) {
  if (!props.open) return null;
  return <HuntWizardBody key={wizardDraftKey(props.hunt?.id)} {...props} />;
}

function HuntWizardBody({ options, hunt, onClose, onSaved }: HuntWizardDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const initial = useMemo(() => initialDraft(options, hunt), [options, hunt]);
  const [draft, setDraft, clearDraft] = usePersistedState<HuntWizardDraft>(wizardDraftKey(hunt?.id), initial, { scope: 'tab', version: 1 });
  const { create, update } = useOfferHunts();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const step = Math.min(Math.max(draft.step, 0), WIZARD_STEPS - 1);
  const last = step === WIZARD_STEPS - 1;
  const { limits } = options;
  // Troca de passo volta o conteúdo ao topo (senão o passo novo abre na rolagem do anterior).
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => { contentRef.current?.scrollTo?.({ top: 0 }); }, [step]);

  const change = (patch: Partial<HuntWizardDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    // Campo mexido deixa de mostrar o erro antigo
    setErrors((e) => {
      const keys = Object.keys(patch).flatMap((k) => (k === 'filters' ? Object.keys(e).filter((x) => x.startsWith('filters.')) : [k, k === 'postingWindow' ? 'weekdaysMask' : '']));
      if (!keys.some((k) => k && e[k])) return e;
      const next = { ...e };
      keys.forEach((k) => delete next[k]);
      return next;
    });
    setSaveError(null);
  };
  const choosePreset = (key: HuntPreset) => setDraft((d) => applyPreset(d, key, options));
  const goTo = (s: number) => setDraft((d) => ({ ...d, step: s }));

  const next = () => {
    const e = validateStep(step, draft, limits);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    goTo(step + 1);
  };

  const close = () => {
    clearDraft();
    onClose();
  };
  const requestCancel = () => {
    if (saving) return;
    if (isDirty(draft, initial)) setConfirmDiscard(true);
    else close();
  };

  const save = async () => {
    const bad = firstInvalidStep(draft, limits);
    if (bad !== null) {
      setErrors(validateStep(bad, draft, limits));
      goTo(bad);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const body = draftToBody(draft);
      const saved = hunt ? await update(hunt.id, body) : await create(body);
      clearDraft();
      onSaved(saved);
    } catch (err) {
      const field = (err as { field?: unknown; meta?: { field?: unknown } | null }).field ?? (err as { meta?: { field?: unknown } | null }).meta?.field;
      if (typeof field === 'string') {
        setErrors({ [field]: offerHunterErrorMessage(err) });
        goTo(stepOfField(field));
      }
      setSaveError(offerHunterErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const title = hunt ? wz.editTitle : wz.createTitle;
  const headings = [wz.what, wz.refine, wz.when] as const;
  const heading = headings[step];
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <>
      <Dialog
        open
        onClose={requestCancel}
        fullScreen={fullScreen}
        fullWidth
        maxWidth="md"
        aria-labelledby="hunt-wizard-title"
        scroll="paper"
      >
        <DialogTitle id="hunt-wizard-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1.5, fontWeight: 700 }}>
          <Box component="span" sx={{ flex: 1 }}>{title}</Box>
          <Tooltip title={wz.close} arrow>
            <IconButton aria-label={wz.close} onClick={requestCancel} disabled={saving}><AppIcon icon={X} size="sm" /></IconButton>
          </Tooltip>
        </DialogTitle>
        <DialogContent dividers ref={contentRef}>
          <Stepper activeStep={step} alternativeLabel aria-label={wz.stepsLabel} sx={{ mb: 3 }}>
            {wz.steps.map((label, i) => (
              <Step key={label} completed={i < step}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          <Box sx={{ mb: 2.5 }}>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>{heading.title}</Typography>
            <Typography variant="body2" color="text.secondary">{heading.subtitle}</Typography>
          </Box>

          {saveError && <Alert severity="error" sx={{ mb: 2 }} role="alert">{saveError}</Alert>}
          {!saveError && hasErrors && <Alert severity="warning" sx={{ mb: 2 }}>{wz.validation.stepHasErrors}</Alert>}

          {step === 0 && <WizardWhatStep draft={draft} options={options} errors={errors} onChange={change} onPreset={choosePreset} />}
          {step === 1 && <WizardRefineStep draft={draft} options={options} errors={errors} onChange={change} />}
          {step === 2 && <WizardWhenStep draft={draft} options={options} errors={errors} onChange={change} huntId={hunt?.id} />}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5, gap: 1, flexWrap: 'wrap' }}>
          <Button color="inherit" onClick={requestCancel} disabled={saving} sx={{ mr: 'auto' }}>{wz.cancel}</Button>
          {step > 0 && (
            <Button onClick={() => { setErrors({}); goTo(step - 1); }} disabled={saving} startIcon={<AppIcon icon={ArrowLeft} size="sm" />}>
              {wz.back}
            </Button>
          )}
          {!last && (
            <Button variant="contained" disableElevation onClick={next} endIcon={<AppIcon icon={ArrowRight} size="sm" />}>{wz.next}</Button>
          )}
          {last && (
            <Button
              variant="contained"
              disableElevation
              onClick={save}
              disabled={saving}
              startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <AppIcon icon={Save} size="sm" />}
            >
              {saving ? wz.saving : wz.save}
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        title={wz.discardTitle}
        description={wz.discardText}
        confirmLabel={wz.discardConfirm}
        cancelLabel={wz.back}
        confirmColor="error"
        onConfirm={() => { setConfirmDiscard(false); close(); }}
        onClose={() => setConfirmDiscard(false)}
      />
    </>
  );
}
