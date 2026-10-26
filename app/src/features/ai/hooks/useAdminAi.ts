import { useCallback, useEffect, useRef, useState } from 'react';
import { adminAiService } from '@/services/adminAi.service';
import type {
  AiCatalogItem,
  AiPlatformProvider,
  AiPlatformSettings,
  AiProviderTestResult,
  CreateAiPlatformProviderRequest,
  UpdateAiPlatformProviderRequest,
} from '@/types/api.types';
import { aiErrorMessage } from '../strings';

const byPriority = (a: AiPlatformProvider, b: AiPlatformProvider) => a.priority - b.priority;

/**
 * Estado local da página de IA da plataforma (sem store global).
 * - modos e ativo/inativo são otimistas, com rollback e `actionError`
 * - criar/editar não é otimista: o diálogo recebe o erro e fica aberto
 */
export function useAdminAi() {
  const [settings, setSettings] = useState<AiPlatformSettings | null>(null);
  const [providers, setProviders] = useState<AiPlatformProvider[]>([]);
  const [catalog, setCatalog] = useState<AiCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, AiProviderTestResult>>({});
  const providersRef = useRef(providers);
  providersRef.current = providers;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [s, list, kinds] = await Promise.all([
        adminAiService.getSettings(),
        adminAiService.listProviders(),
        adminAiService.getCatalog(),
      ]);
      setSettings(s);
      setCatalog(kinds);
      setProviders([...list].sort(byPriority));
    } catch (err) {
      setLoadError(aiErrorMessage(err, 'admin'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateSettings = useCallback(async (next: AiPlatformSettings) => {
    if (!next.platformEnabled && !next.tenantKeysEnabled) return;
    const previous = settingsRef.current;
    setSettings(next);
    setSavingSettings(true);
    try {
      setSettings(await adminAiService.updateSettings(next));
    } catch (err) {
      setSettings(previous);
      setActionError(aiErrorMessage(err, 'admin'));
    } finally {
      setSavingSettings(false);
    }
  }, []);

  const replace = (item: AiPlatformProvider) =>
    setProviders((prev) => prev.map((p) => (p.id === item.id ? item : p)).sort(byPriority));

  const clearTest = (id: string) =>
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const create = useCallback(async (body: CreateAiPlatformProviderRequest) => {
    const created = await adminAiService.createProvider(body);
    setProviders((prev) => [...prev, created].sort(byPriority));
  }, []);

  const update = useCallback(async (id: string, body: UpdateAiPlatformProviderRequest) => {
    replace(await adminAiService.updateProvider(id, body));
    clearTest(id);
  }, []);

  const setEnabled = useCallback(async (id: string, enabled: boolean) => {
    const previous = providersRef.current.find((p) => p.id === id);
    if (!previous) return;
    replace({ ...previous, enabled });
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      replace(await adminAiService.updateProvider(id, { enabled }));
    } catch (err) {
      replace(previous);
      setActionError(aiErrorMessage(err, 'admin'));
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    const snapshot = providersRef.current;
    setProviders((prev) => prev.filter((p) => p.id !== id));
    try {
      await adminAiService.removeProvider(id);
      clearTest(id);
    } catch (err) {
      setProviders(snapshot);
      setActionError(aiErrorMessage(err, 'admin'));
    }
  }, []);

  const test = useCallback(async (id: string) => {
    setTesting((s) => ({ ...s, [id]: true }));
    clearTest(id);
    try {
      const result = await adminAiService.testProvider(id);
      setTestResults((r) => ({ ...r, [id]: result }));
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      setTestResults((r) => ({ ...r, [id]: { ok: false, errorCode: typeof code === 'string' ? code : undefined } }));
    } finally {
      setTesting((s) => ({ ...s, [id]: false }));
    }
  }, []);

  return {
    settings,
    providers,
    catalog,
    loading,
    loadError,
    reload: load,
    savingSettings,
    updateSettings,
    busy,
    testing,
    testResults,
    create,
    update,
    setEnabled,
    remove,
    test,
    actionError,
    clearActionError: () => setActionError(null),
  };
}
