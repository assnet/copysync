import { useCallback, useEffect, useRef, useState } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { isServiceUnavailable } from '@/services/apiClient';
import { adminCostsService } from '@/services/adminCosts.service';
import { settingsToDraft } from './rules';
import { infraCostsStrings } from './strings';
import type { InfraCostSettings, InfraCostSettingsDraft, InfraCostSettingsView } from './types';

const S = infraCostsStrings;

export const COST_PRICES_DRAFT_KEY = 'costs.prices.draft';

/** Rascunho salvo na aba: valores digitados + `updatedAt` em que foram baseados (vira `expectedUpdatedAt`). */
export interface CostPricesDraftState {
  base: string | null;
  values: InfraCostSettingsDraft;
}

export interface CostSettingsNotice { severity: 'success' | 'warning' | 'error'; text: string }

/** Caminho `items[0].storage.gb` → segmentos (`items`, 0, `storage`, `gb`). */
export function parseDraftPath(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const part of path.split('.')) {
    const m = part.match(/^([^[\]]+)((?:\[\d+\])*)$/);
    if (!m) throw new Error(`invalid path: ${path}`);
    out.push(m[1]);
    for (const idx of m[2].matchAll(/\[(\d+)\]/g)) out.push(Number(idx[1]));
  }
  return out;
}

/** Cópia do rascunho com `value` no caminho (só os nós do caminho são copiados). */
export function setDraftPath<T>(root: T, path: string, value: unknown): T {
  const segs = parseDraftPath(path);
  const write = (node: unknown, i: number): unknown => {
    if (i === segs.length) return value;
    const seg = segs[i];
    if (Array.isArray(node)) {
      const copy = [...node];
      copy[seg as number] = write(node[seg as number], i + 1);
      return copy;
    }
    const obj = (node ?? {}) as Record<string, unknown>;
    return { ...obj, [seg]: write(obj[seg as string], i + 1) };
  };
  return write(root, 0) as T;
}

/**
 * Configuração de preços (COST-08): leitura, rascunho persistido na aba (`costs.prices.draft`) e
 * gravação com `expectedUpdatedAt`. 400 marca o campo de `meta.field`; 409 recarrega o salvo,
 * **mantém** o rascunho (rebaseado no `updatedAt` novo) e avisa.
 */
export function useCostSettings() {
  const [view, setView] = useState<InfraCostSettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** API fora do ar (deploy); só limpa ao concluir a próxima leitura. */
  const [loadUnavailable, setLoadUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<CostSettingsNotice | null>(null);
  const [draft, setDraft, clearDraft] = usePersistedState<CostPricesDraftState | null>(COST_PRICES_DRAFT_KEY, null, { scope: 'tab' });
  const restored = useRef(draft !== null).current;

  const fetchView = useCallback(async (): Promise<InfraCostSettingsView | null> => {
    setLoading(true);
    setLoadError(null);
    try {
      const v = await adminCostsService.getSettings();
      setView(v);
      setLoadUnavailable(false);
      return v;
    } catch (err) {
      setLoadError(S.errors.loadFailed);
      setLoadUnavailable(isServiceUnavailable(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchView();
  }, [fetchView]);

  const values: InfraCostSettingsDraft | null = draft?.values ?? (view ? settingsToDraft(view.settings) : null);

  /** Altera um campo; limpa o erro da API daquele caminho. */
  const change = useCallback((path: string, value: unknown) => {
    if (!view) return;
    setDraft((prev) => ({
      // `prev.base` pode ser `null` (rascunho de antes de existir linha): mantém, para o PUT dar 409.
      base: prev ? prev.base : view.updatedAt,
      values: setDraftPath(prev?.values ?? settingsToDraft(view.settings), path, value),
    }));
    // Sai o erro do próprio caminho e o de quem o contém (`items[0]`, `items`) ou é contido por ele.
    setServerErrors((prev) => {
      const related = (k: string) => k === path || path.startsWith(`${k}.`) || path.startsWith(`${k}[`) || k.startsWith(`${path}.`) || !k.includes('.') && !k.includes('[');
      const keys = Object.keys(prev).filter(related);
      if (keys.length === 0) return prev;
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
  }, [setDraft, view]);

  /** Troca uma lista inteira (incluir/remover linha). Índices mudam: erros da API saem. */
  const replace = useCallback((mutate: (values: InfraCostSettingsDraft) => InfraCostSettingsDraft) => {
    if (!view) return;
    setDraft((prev) => ({
      base: prev ? prev.base : view.updatedAt,
      values: mutate(prev?.values ?? settingsToDraft(view.settings)),
    }));
    setServerErrors({});
  }, [setDraft, view]);

  const discard = useCallback(() => {
    clearDraft();
    setServerErrors({});
  }, [clearDraft]);

  /** `true` quando gravou. */
  const save = useCallback(async (settings: InfraCostSettings): Promise<boolean> => {
    if (!view) return false;
    setSaving(true);
    try {
      const saved = await adminCostsService.updateSettings({
        settings,
        expectedUpdatedAt: draft ? draft.base : view.updatedAt,
      });
      setView(saved);
      clearDraft();
      setServerErrors({});
      setNotice({ severity: 'success', text: S.prices.saved });
      return true;
    } catch (err) {
      const e = err as { status?: number; code?: string; field?: unknown };
      if (e.status === 409 || e.code === 'INFRA_COST_SETTINGS_CONFLICT') {
        setServerErrors({});
        const fresh = await fetchView();
        // Mantém o que foi digitado, agora sobre o salvo mais novo: o próximo diff já mostra a diferença real.
        if (fresh) setDraft((prev) => ({ base: fresh.updatedAt, values: prev?.values ?? settingsToDraft(settings) }));
        setNotice({ severity: 'warning', text: S.errors.conflict });
      } else if (e.status === 400 || e.code === 'INVALID_INFRA_COST_SETTINGS') {
        if (typeof e.field === 'string' && e.field) setServerErrors({ [e.field]: S.errors.fieldRejected });
        setNotice({ severity: 'error', text: S.errors.invalid });
      } else {
        setNotice({ severity: 'error', text: S.errors.saveFailed });
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [clearDraft, draft, fetchView, setDraft, view]);

  return {
    view, values, loading, loadError, loadUnavailable, saving, serverErrors, notice,
    dirty: draft !== null, restored: restored && draft !== null,
    change, replace, discard, save,
    reload: fetchView,
    clearNotice: () => setNotice(null),
  };
}
