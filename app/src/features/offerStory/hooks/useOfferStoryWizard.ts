import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { isPlanFeatureUnavailable } from '@/features/plans/planGate';
import { offerStoryService } from '@/services/offerStory.service';
import { offerStoryUpgradePath } from '../planGate';
import {
  PRODUCT_FORM_DEFAULTS,
  hasErrors,
  mapRenderError,
  toRenderInput,
  validateProductForm,
  type ProductField,
  type ProductFormErrors,
  type ProductFormState,
} from '../productForm';
import type { OfferStoryResult } from '../types';

/** 0 = template, 1 = produto, 2 = compartilhar. */
export type OfferStoryStep = 0 | 1 | 2;

/** Estado de trabalho persistido na aba. A arte (resultado) nunca é salva. */
export interface OfferStoryDraft extends ProductFormState {
  step: OfferStoryStep;
  templateId: string;
}

export const WIZARD_KEY = 'offerStory.wizard';
export const WIZARD_VERSION = 1;
export const WIZARD_DEFAULTS: OfferStoryDraft = { step: 0, templateId: '', ...PRODUCT_FORM_DEFAULTS };

/** Passo 3 sem arte (reload) volta ao 2: os campos continuam lá para gerar de novo. */
export function restoreDraft(raw: unknown): OfferStoryDraft {
  const d = { ...WIZARD_DEFAULTS, ...((raw && typeof raw === 'object' ? raw : {}) as Partial<OfferStoryDraft>) };
  const step: OfferStoryStep = d.step === 2 ? 1 : d.step === 1 && d.templateId ? 1 : 0;
  return { ...d, step };
}

/**
 * Assistente do Story de Oferta: passos, rascunho (persistido), geração e erro por campo.
 * Regras de formulário em `productForm.ts`; aqui só orquestração.
 */
export function useOfferStoryWizard() {
  const navigate = useNavigate();
  const [draft, setDraft, clearDraft] = usePersistedState<OfferStoryDraft>(WIZARD_KEY, WIZARD_DEFAULTS, {
    version: WIZARD_VERSION,
    deserialize: restoreDraft,
  });
  const [result, setResult] = useState<OfferStoryResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Garante a regra mesmo se o estado chegar ao passo 3 sem arte por outro caminho.
  const step: OfferStoryStep = draft.step === 2 && !result ? 1 : draft.step;

  const selectTemplate = useCallback((templateId: string) => setDraft((d) => ({ ...d, templateId })), [setDraft]);
  const goTo = useCallback((next: OfferStoryStep) => {
    setGeneralError(null);
    setDraft((d) => ({ ...d, step: next }));
  }, [setDraft]);

  const setField = useCallback(<K extends keyof ProductFormState>(field: K, value: ProductFormState[K]) => {
    setDraft((d) => ({ ...d, [field]: value }));
    const key = (field === 'couponEnabled' ? null : field) as ProductField | null;
    if (key) setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
    if (field === 'couponEnabled' && !value) setErrors((e) => ({ url: e.url }));
  }, [setDraft]);

  const generate = useCallback(async () => {
    const found = validateProductForm(draft);
    setErrors(found);
    setGeneralError(null);
    if (hasErrors(found) || generating) return;
    setGenerating(true);
    try {
      const art = await offerStoryService.render(toRenderInput(draft.templateId, draft));
      setResult(art);
      setDraft((d) => ({ ...d, step: 2 }));
    } catch (err) {
      if (isPlanFeatureUnavailable(err)) {
        navigate(offerStoryUpgradePath, { replace: true });
        return;
      }
      const view = mapRenderError(err);
      if (view.backToTemplates) {
        setDraft((d) => ({ ...d, step: 0, templateId: '' }));
        setGeneralError(view.message);
      } else if (view.field) setErrors({ [view.field]: view.message });
      else setGeneralError(view.message);
    } finally {
      setGenerating(false);
    }
  }, [draft, generating, navigate, setDraft]);

  /** "Editar": volta ao passo 2 com os campos; a arte anterior é descartada. */
  const edit = useCallback(() => {
    setResult(null);
    goTo(1);
  }, [goTo]);

  /** "Nova arte": limpa tudo e volta ao passo 1. */
  const reset = useCallback(() => {
    setResult(null);
    setErrors({});
    setGeneralError(null);
    clearDraft();
  }, [clearDraft]);

  return {
    step,
    templateId: draft.templateId,
    form: draft as ProductFormState,
    errors,
    generalError,
    dismissError: () => setGeneralError(null),
    generating,
    result,
    selectTemplate,
    goTo,
    setField,
    generate,
    edit,
    reset,
  };
}
