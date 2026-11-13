import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Step, StepLabel, Stepper,
  Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { ArrowLeft, ArrowRight, Save, X } from 'lucide-react';
import { AppIcon, ConfirmDialog } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { Hunt, HuntOptions, HuntPreset, HuntProvider } from '../../types';
import { offerHunterErrorMessage, offerHunterStrings as t } from '../../strings';
import { useHuntAiSuggest, useHuntOptions, useHuntProviders, useOfferHunts } from '../../hooks';
import { capabilitiesOf, providerOf } from '../../providers';
import {
  WIZARD_DRAFT_VERSION, WIZARD_STEPS, applyAiSuggestion, applyPreset, draftToBody, dropChangedHints, firstInvalidStep, initialDraft,
  isDirty, seedProvider, stepOfField, validateStep, wizardDraftKey, type FieldErrors, type HuntWizardAiState, type HuntWizardDraft,
} from './wizardDraft';
import { HuntProviderMark, WizardProviderStep } from './WizardProviderStep';
import { WizardAiSuggestPanel } from './WizardAiSuggestPanel';
import { WizardWhatStep } from './WizardWhatStep';
import { WizardRefineStep } from './WizardRefineStep';
import { WizardWhenStep } from './WizardWhenStep';

const wz = t.wizard;

/**
 * Assistente de 4 passos. `hunt` presente = edição (loja fixa); ausente = nova caçada. `options` = opções de uma
 * loja já carregadas pela tela (limites; reaproveitadas se a loja escolhida for a mesma, senão o assistente busca as
 * da loja). `onSaved` recebe a caçada gravada pela API.
 */
export interface HuntWizardDialogProps {
  open: boolean;
  options: HuntOptions;
  hunt?: Hunt;
  /** Abre o aviso de risco da loja (CTA do passo 0). */
  onOpenRisk?: (provider: HuntProvider) => void;
  /** Muda depois de um aceite de aviso: recarrega o estado das lojas e as opções. */
  refreshKey?: number;
  onClose: () => void;
  onSaved: (hunt: Hunt) => void;
}

/**
 * Assistente Loja → O que caçar → Refino → Quando e onde. Rascunho por aba (uma chave por caçada em edição),
 * limpo ao salvar ou cancelar. Monta só aberto: a chave do rascunho é lida a cada abertura.
 */
export function HuntWizardDialog(props: HuntWizardDialogProps) {
  if (!props.open) return null;
  return <HuntWizardBody key={wizardDraftKey(props.hunt?.id)} {...props} />;
}

function HuntWizardBody({ options, hunt, onOpenRisk, refreshKey, onClose, onSaved }: HuntWizardDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const initial = useMemo(() => initialDraft(options, hunt), [options, hunt]);
  const [draft, setDraft, clearDraft] = usePersistedState<HuntWizardDraft>(
    wizardDraftKey(hunt?.id), initial, { scope: 'tab', version: WIZARD_DRAFT_VERSION },
  );
  const { create, update } = useOfferHunts();
  const providers = useHuntProviders(!hunt);
  // Opções da loja escolhida: as da tela se for a mesma loja; senão, carregadas aqui
  const baseProvider = providerOf(options);
  const chosen = draft.provider;
  const fetched = useHuntOptions(chosen && chosen !== baseProvider ? chosen : null);
  const providerOptions = !chosen ? null : chosen === baseProvider ? options : fetched.options;
  const aiSuggest = useHuntAiSuggest();
  const [aiRemaining, setAiRemaining] = useState<number | null>(null);
  const [aiBlocked, setAiBlocked] = useState(false);
  const reloadProviders = providers.reload;
  const reloadFetched = fetched.reload;
  const firstRefresh = useRef(refreshKey);
  useEffect(() => {
    if (firstRefresh.current === refreshKey) return;
    firstRefresh.current = refreshKey;
    if (!hunt) void reloadProviders();
    void reloadFetched();
  }, [refreshKey, hunt, reloadProviders, reloadFetched]);
  // Loja nova escolhida: as predefinições dela preenchem o rascunho (uma vez por loja)
  useEffect(() => {
    if (hunt || !providerOptions || !chosen || draft.presetFor === chosen || providerOf(providerOptions) !== chosen) return;
    setDraft((d) => (d.provider === chosen && d.presetFor !== chosen ? seedProvider(d, providerOptions) : d));
  }, [hunt, providerOptions, chosen, draft.presetFor, setDraft]);
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
    setDraft((d) => dropChangedHints(d, { ...d, ...patch }));
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
  const choosePreset = (key: HuntPreset) => {
    if (providerOptions) setDraft((d) => dropChangedHints(d, applyPreset(d, key, providerOptions)));
  };
  const goTo = (s: number) => setDraft((d) => ({ ...d, step: s }));
  const selectProvider = (provider: HuntProvider) => {
    if (hunt) return;
    setDraft((d) => (d.provider === provider ? d : { ...d, provider }));
    setErrors((e) => {
      if (!e.provider) return e;
      const { provider: _drop, ...rest } = e;
      return rest;
    });
  };
  const changeAi = (patch: Partial<HuntWizardAiState>) => {
    setDraft((d) => ({ ...d, ai: { ...d.ai, ...patch } }));
    if (patch.intent !== undefined || patch.pickProduct !== undefined) aiSuggest.clearError();
  };
  const generate = async () => {
    const opts = providerOptions;
    const provider = draft.provider;
    if (!opts || !provider) return;
    const { data, errorCode } = await aiSuggest.suggest({ provider, intent: draft.ai.intent.trim() || null, pickProduct: draft.ai.pickProduct });
    if (data) {
      setAiRemaining(data.remainingToday);
      setDraft((d) => applyAiSuggestion(d.presetFor === provider ? d : seedProvider(d, opts), data, opts));
      return;
    }
    if (errorCode === 'OFFER_HUNT_AI_SUGGEST_DAILY_LIMIT') setAiRemaining(0);
    if (errorCode === 'AI_NOT_CONFIGURED') setAiBlocked(true);
  };
  const aiAvailable = !aiBlocked && (providerOptions?.gates.aiAvailable
    ?? providers.providers?.find((x) => x.provider === chosen)?.gates.aiAvailable
    ?? options.gates.aiAvailable);
  // Sem as opções da loja não dá para montar os passos seguintes
  const optionsPending = Boolean(chosen) && !providerOptions;

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
      const body = draftToBody(draft, capabilitiesOf(providerOptions, draft.provider ?? undefined));
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
  const headings = [
    { title: wz.provider.title, subtitle: hunt ? wz.provider.editSubtitle : wz.provider.subtitle }, wz.what, wz.refine, wz.when,
  ] as const;
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
          <Box component="span" sx={{ flex: 1, minWidth: 0 }}>{title}</Box>
          {chosen && step > 0 && <Box sx={{ display: { xs: 'none', sm: 'inline-flex' } }}><HuntProviderMark provider={chosen} size={24} /></Box>}
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

          {step === 0 && (
            <Stack spacing={2.5}>
              <WizardProviderStep
                provider={chosen}
                editing={Boolean(hunt)}
                providers={providers.providers}
                providersLoading={providers.loading}
                providersFailed={Boolean(providers.errorCode)}
                onRetryProviders={() => void providers.reload()}
                onSelect={selectProvider}
                onOpenRisk={onOpenRisk}
                error={errors.provider}
              />
              {optionsPending && !fetched.errorCode && (
                <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                  <CircularProgress size={16} /><Typography variant="body2">{wz.provider.optionsLoading}</Typography>
                </Box>
              )}
              {optionsPending && fetched.errorCode && (
                <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void fetched.reload()}>{t.page.retry}</Button>}>
                  {wz.provider.optionsError}
                </Alert>
              )}
              {chosen && (
                <WizardAiSuggestPanel
                  provider={chosen}
                  ai={draft.ai}
                  available={aiAvailable}
                  ready={Boolean(providerOptions)}
                  loading={aiSuggest.loading}
                  errorCode={aiSuggest.errorCode}
                  remainingToday={aiRemaining}
                  intentError={errors.aiIntent}
                  onChange={changeAi}
                  onGenerate={() => void generate()}
                />
              )}
            </Stack>
          )}
          {step > 0 && !providerOptions && (
            <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress aria-label={wz.provider.optionsLoading} /></Box>
          )}
          {step === 1 && providerOptions && <WizardWhatStep draft={draft} options={providerOptions} errors={errors} onChange={change} onPreset={choosePreset} />}
          {step === 2 && providerOptions && <WizardRefineStep draft={draft} options={providerOptions} errors={errors} onChange={change} />}
          {step === 3 && providerOptions && <WizardWhenStep draft={draft} options={providerOptions} errors={errors} onChange={change} huntId={hunt?.id} />}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5, gap: 1, flexWrap: 'wrap' }}>
          <Button color="inherit" onClick={requestCancel} disabled={saving} sx={{ mr: 'auto' }}>{wz.cancel}</Button>
          {step > 0 && (
            <Button onClick={() => { setErrors({}); goTo(step - 1); }} disabled={saving} startIcon={<AppIcon icon={ArrowLeft} size="sm" />}>
              {wz.back}
            </Button>
          )}
          {!last && (
            <Button variant="contained" disableElevation onClick={next} disabled={optionsPending || aiSuggest.loading} endIcon={<AppIcon icon={ArrowRight} size="sm" />}>{wz.next}</Button>
          )}
          {last && (
            <Button
              variant="contained"
              disableElevation
              onClick={save}
              disabled={saving || !providerOptions}
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
