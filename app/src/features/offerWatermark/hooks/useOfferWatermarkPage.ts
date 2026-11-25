import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '@/contexts/TenantContext';
import { usePersistedState } from '@/hooks/usePersistedState';
import { offerWatermarkService } from '../offerWatermark.service';
import { isWatermarkHidden, isWatermarkPlanLocked, saveErrorMessage } from '../errors';
import { WATERMARK_DEFAULTS, draftProblem, draftToUpdate, isDraftDirty, toDraft } from '../rules';
import type { OfferWatermark, WatermarkDraft } from '../types';

/** Mude ao alterar `WatermarkDraft`: rascunho salvo em outro formato é descartado. */
export const WATERMARK_DRAFT_VERSION = 1;

export type WatermarkPageStatus = 'loading' | 'ready' | 'locked' | 'error';

/**
 * Estado da página "Marca d'água". O servidor é a fonte (`GET /offer-watermark`, recarregado a cada
 * montagem); o rascunho dos ajustes fica em `usePersistedState` (escopo `tab`, por tenant) e é limpo ao
 * salvar. O logo nunca vai para o storage do navegador: só a URL da API, em memória.
 * 403 de plano → `locked`; 404 (fora da audiência) → `/dashboard`.
 */
export function useOfferWatermarkPage() {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const [status, setStatus] = useState<WatermarkPageStatus>('loading');
  const [saved, setSaved] = useState<OfferWatermark | null>(null);
  const [draft, setDraft, clearDraft] = usePersistedState<WatermarkDraft | null>(
    `offerWatermark.draft.${activeTenantId ?? ''}`,
    null,
    { version: WATERMARK_DRAFT_VERSION },
  );
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);

  /** Erro comum às chamadas: plano → bloqueio; audiência → sai da tela. true = tratado. */
  const handleGate = useCallback((err: unknown): boolean => {
    if (isWatermarkHidden(err)) {
      navigate('/dashboard', { replace: true });
      return true;
    }
    if (isWatermarkPlanLocked(err)) {
      setStatus('locked');
      return true;
    }
    return false;
  }, [navigate]);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setSaved(await offerWatermarkService.get());
      setStatus('ready');
    } catch (err) {
      if (!handleGate(err)) setStatus('error');
    }
  }, [handleGate]);

  useEffect(() => {
    void load();
  }, [load]);

  const canEdit = saved?.canEdit === true;
  const value: WatermarkDraft = draft ?? (saved ? toDraft(saved) : WATERMARK_DEFAULTS);
  const dirty = canEdit && isDraftDirty(draft, saved);
  const problem = draftProblem(value);

  const patch = useCallback((p: Partial<WatermarkDraft>) => {
    if (!canEdit) return;
    setDraft((prev) => ({ ...(prev ?? (saved ? toDraft(saved) : WATERMARK_DEFAULTS)), ...p }));
  }, [canEdit, saved, setDraft]);

  const save = useCallback(async () => {
    if (!canEdit || problem) return;
    setSaving(true);
    setError(null);
    const sent = draftRef.current;
    try {
      setSaved(await offerWatermarkService.update(draftToUpdate(value)));
      // Alteração feita durante o salvar fica no rascunho
      if (draftRef.current === sent) clearDraft();
      setSavedToast(true);
    } catch (err) {
      if (!handleGate(err)) setError(saveErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [canEdit, problem, value, clearDraft, handleGate]);

  const discard = useCallback(() => {
    clearDraft();
    setError(null);
  }, [clearDraft]);

  /** Logo enviado por `chunkedUpload`: a API valida e devolve a marca atualizada. Lança em erro de mídia. */
  const applyLogo = useCallback(async (uploadId: string) => {
    try {
      setSaved(await offerWatermarkService.setImage(uploadId));
    } catch (err) {
      if (!handleGate(err)) throw err;
    }
  }, [handleGate]);

  const removeLogo = useCallback(async () => {
    try {
      setSaved(await offerWatermarkService.removeImage());
    } catch (err) {
      if (!handleGate(err)) throw err;
    }
  }, [handleGate]);

  return {
    status, saved, value, canEdit, dirty, problem, saving, error, savedToast,
    patch, save, discard, reload: load, applyLogo, removeLogo,
    dismissError: () => setError(null),
    closeToast: () => setSavedToast(false),
  };
}

export type OfferWatermarkPageState = ReturnType<typeof useOfferWatermarkPage>;
