import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearPersisted, readPersisted, usePersistedState, writePersisted } from '@/hooks/usePersistedState';
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
import { RESULT_KEY, WIZARD_KEY } from '../sessionState';

export { RESULT_KEY, WIZARD_KEY };

/** 0 = template, 1 = produto, 2 = compartilhar. */
export type OfferStoryStep = 0 | 1 | 2;

/** Estado de trabalho persistido na aba. A arte fica em chave própria (`RESULT_KEY`). */
export interface OfferStoryDraft extends ProductFormState {
  step: OfferStoryStep;
  templateId: string;
}

export const WIZARD_VERSION = 1;
export const WIZARD_DEFAULTS: OfferStoryDraft = { step: 0, templateId: '', ...PRODUCT_FORM_DEFAULTS };

/** Passo 2 sem template volta ao 1. Passo 3 sem arte salva vira 2 no hook (`step` derivado). */
export function restoreDraft(raw: unknown): OfferStoryDraft {
  const d = { ...WIZARD_DEFAULTS, ...((raw && typeof raw === 'object' ? raw : {}) as Partial<OfferStoryDraft>) };
  const step: OfferStoryStep = d.templateId && (d.step === 1 || d.step === 2) ? d.step : 0;
  return { ...d, step };
}

/** Arte gerada (data URL ~100–250 KB) na aba, separada do rascunho: falha de cota não afeta o resto. */
export const RESULT_VERSION = 1;
const JPEG_PREFIX = 'data:image/jpeg;base64,';

/** Valida a forma do resultado salvo; qualquer divergência descarta (volta ao passo 2). */
export function restoreResult(raw: unknown): OfferStoryResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<OfferStoryResult>;
  const ok =
    typeof r.image === 'string' && r.image.startsWith(JPEG_PREFIX) && r.image.length > JPEG_PREFIX.length &&
    typeof r.templateId === 'string' && r.templateId !== '' &&
    typeof r.headline === 'string' && typeof r.affiliateUrl === 'string' && typeof r.provider === 'string' &&
    typeof r.width === 'number' && typeof r.height === 'number' && typeof r.attributionVerified === 'boolean' &&
    !!r.price && typeof r.price === 'object' && Array.isArray(r.warnings) &&
    (r.coupon === null || (!!r.coupon && typeof r.coupon.code === 'string'));
  return ok ? (r as OfferStoryResult) : null;
}

const RESULT_OPTS = { version: RESULT_VERSION, deserialize: restoreResult };

/**
 * Resultado persistido com degradação: apaga o salvo antes de gravar o novo, então se a cota estourar
 * (`writePersisted` engole o erro) não sobra arte antiga — a nova vale só em memória e o reload cai no passo 2.
 */
function usePersistedResult() {
  const [result, setResult] = useState<OfferStoryResult | null>(() => readPersisted(RESULT_KEY, RESULT_OPTS) ?? null);
  useEffect(() => {
    clearPersisted(RESULT_KEY);
    if (result) writePersisted(RESULT_KEY, result, RESULT_OPTS);
  }, [result]);
  return [result, setResult] as const;
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
  const [result, setResult] = usePersistedResult();
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
  }, [draft, generating, navigate, setDraft, setResult]);

  /** Arte salva cujo template saiu do catálogo: descarta (a página chama com os ids carregados). */
  const dropStaleResult = useCallback((ids: readonly string[]) => {
    setResult((r) => (r && !ids.includes(r.templateId) ? null : r));
  }, [setResult]);

  /** "Editar": volta ao passo 2 com os campos; a arte anterior é descartada. */
  const edit = useCallback(() => {
    setResult(null);
    goTo(1);
  }, [goTo, setResult]);

  /** "Nova arte": limpa tudo e volta ao passo 1. */
  const reset = useCallback(() => {
    setResult(null);
    setErrors({});
    setGeneralError(null);
    clearDraft();
  }, [clearDraft, setResult]);

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
    dropStaleResult,
  };
}
