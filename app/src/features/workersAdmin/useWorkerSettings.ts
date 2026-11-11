import { useCallback, useEffect, useRef, useState } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { adminWorkersService } from '@/services/adminWorkers.service';
import { WORKER_SETTINGS_FIELDS } from './rules';
import { workersAdminStrings } from './strings';
import type {
  WorkerOccupancyList,
  WorkerScalingSettings,
  WorkerScalingSettingsDraft,
  WorkerScalingSettingsField,
  WorkerScalingSettingsView,
} from './types';

const s = workersAdminStrings.settings;

export const WORKER_SETTINGS_DRAFT_KEY = 'workers.settings.draft';

/** Rascunho salvo na aba: valores digitados + `updatedAt` em que foram baseados (vira `expectedUpdatedAt`). */
export interface WorkerSettingsDraftState {
  base: string | null;
  values: WorkerScalingSettingsDraft;
}

export type FieldErrors = Partial<Record<WorkerScalingSettingsField, string>>;
export interface WorkerSettingsNotice { severity: 'success' | 'warning' | 'error'; text: string }

/** Sessões do worker mais ocupado agora (ou do processo, com a adoção desligada); `null` sem dado. */
export function busiestSessions(list: WorkerOccupancyList): number | null {
  const counts = list.adoptionEnabled === false
    ? (list.processes ?? []).map((p) => p.sessions)
    : list.workers.map((w) => w.sessions);
  return counts.length ? Math.max(...counts) : null;
}

function isField(value: unknown): value is WorkerScalingSettingsField {
  return typeof value === 'string' && (WORKER_SETTINGS_FIELDS as string[]).includes(value);
}

/**
 * Configuração de escala (WSCALE-07): leitura, rascunho persistido na aba e gravação com
 * `expectedUpdatedAt`. 409 recarrega e descarta o rascunho; 400 marca o campo de `meta.field`.
 */
export function useWorkerSettings() {
  const [view, setView] = useState<WorkerScalingSettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busiest, setBusiest] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<WorkerSettingsNotice | null>(null);
  const [draft, setDraft, clearDraft] = usePersistedState<WorkerSettingsDraftState | null>(WORKER_SETTINGS_DRAFT_KEY, null);
  const restored = useRef(draft !== null).current;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setView(await adminWorkersService.getSettings());
    } catch {
      setLoadError(s.errors.loadFailed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Ocupação atual só alimenta o aviso de teto abaixo dela: falha não bloqueia a tela.
    adminWorkersService.list().then((list) => setBusiest(busiestSessions(list)), () => setBusiest(null));
  }, [load]);

  const values: WorkerScalingSettingsDraft | null = draft?.values ?? view?.settings ?? null;

  const change = useCallback((patch: Partial<WorkerScalingSettingsDraft>) => {
    if (!view) return;
    setDraft((prev) => ({
      base: prev?.base ?? view.updatedAt,
      values: { ...(prev?.values ?? view.settings), ...patch } as WorkerScalingSettingsDraft,
    }));
    setServerErrors((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(patch) as WorkerScalingSettingsField[]) delete next[k];
      return next;
    });
  }, [setDraft, view]);

  const discard = useCallback(() => {
    clearDraft();
    setServerErrors({});
  }, [clearDraft]);

  /** `true` quando gravou. */
  const save = useCallback(async (settings: WorkerScalingSettings): Promise<boolean> => {
    if (!view) return false;
    setSaving(true);
    try {
      const saved = await adminWorkersService.updateSettings({
        settings,
        expectedUpdatedAt: draft ? draft.base : view.updatedAt,
      });
      setView(saved);
      clearDraft();
      setServerErrors({});
      setNotice({ severity: 'success', text: s.saved });
      return true;
    } catch (err) {
      const e = err as { status?: number; code?: string; field?: unknown };
      if (e.status === 409 || e.code === 'WORKER_SCALING_SETTINGS_CONFLICT') {
        clearDraft();
        setServerErrors({});
        await load();
        setNotice({ severity: 'warning', text: s.errors.conflict });
      } else if (e.status === 400 || e.code === 'INVALID_WORKER_SCALING_SETTINGS') {
        if (isField(e.field)) setServerErrors({ [e.field]: s.fieldRejected });
        setNotice({ severity: 'error', text: s.errors.invalid });
      } else {
        setNotice({ severity: 'error', text: s.errors.saveFailed });
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [clearDraft, draft, load, view]);

  return {
    view, values, loading, loadError, busiest, saving, serverErrors, notice,
    dirty: draft !== null, restored: restored && draft !== null,
    change, discard, save, reload: load, clearNotice: () => setNotice(null),
  };
}
