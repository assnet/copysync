import { useCallback, useEffect, useRef, useState } from 'react';
import { adminLinkDomainsService } from '@/services/adminLinkDomains.service';
import { linkDomainErrorMessage } from '../errors';
import type {
  CreateLinkDomainRequest,
  LinkDomain,
  LinkDomainProbeResult,
  UpdateLinkDomainRequest,
} from '../types';

const byHostname = (a: LinkDomain, b: LinkDomain) => a.hostname.localeCompare(b.hostname);

/**
 * Estado local da tela de domínios (sem store global).
 * - ativo/pausado é otimista, com rollback e `actionError`
 * - criar/editar não é otimista: o diálogo recebe o erro e fica aberto
 * - resultado do probe fica em memória só para exibir o motivo; `lastProbe*` vem da API
 */
export function useAdminLinkDomains() {
  const [domains, setDomains] = useState<LinkDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [probing, setProbing] = useState<Record<string, boolean>>({});
  const [probeResults, setProbeResults] = useState<Record<string, LinkDomainProbeResult>>({});
  const domainsRef = useRef(domains);
  domainsRef.current = domains;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setDomains([...(await adminLinkDomainsService.list())].sort(byHostname));
    } catch (err) {
      setLoadError(linkDomainErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replace = (item: LinkDomain) =>
    setDomains((prev) => prev.map((d) => (d.id === item.id ? item : d)).sort(byHostname));
  const flag = (set: typeof setBusy, id: string, v: boolean) => set((prev) => ({ ...prev, [id]: v }));

  const create = useCallback(async (body: CreateLinkDomainRequest) => {
    const item = await adminLinkDomainsService.create(body);
    setDomains((prev) => [...prev, item].sort(byHostname));
    return item;
  }, []);

  const update = useCallback(async (id: string, body: UpdateLinkDomainRequest) => {
    const item = await adminLinkDomainsService.update(id, body);
    replace(item);
    return item;
  }, []);

  const setActive = useCallback(async (id: string, active: boolean) => {
    const previous = domainsRef.current.find((d) => d.id === id);
    if (!previous) return;
    replace({ ...previous, status: active ? 'ACTIVE' : 'PAUSED' });
    flag(setBusy, id, true);
    try {
      replace(await adminLinkDomainsService.update(id, { status: active ? 'ACTIVE' : 'PAUSED' }));
    } catch (err) {
      replace(previous);
      setActionError(linkDomainErrorMessage(err));
    } finally {
      flag(setBusy, id, false);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    flag(setBusy, id, true);
    try {
      await adminLinkDomainsService.remove(id);
      setDomains((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setActionError(linkDomainErrorMessage(err));
    } finally {
      flag(setBusy, id, false);
    }
  }, []);

  const probe = useCallback(async (id: string): Promise<LinkDomainProbeResult | null> => {
    flag(setProbing, id, true);
    try {
      const result = await adminLinkDomainsService.probe(id);
      setProbeResults((prev) => ({ ...prev, [id]: result }));
      const current = domainsRef.current.find((d) => d.id === id);
      if (current) replace({ ...current, lastProbeAt: result.probedAt, lastProbeOk: result.ok });
      return result;
    } catch (err) {
      setActionError(linkDomainErrorMessage(err));
      return null;
    } finally {
      flag(setProbing, id, false);
    }
  }, []);

  return {
    domains,
    loading,
    loadError,
    actionError,
    clearActionError: () => setActionError(null),
    busy,
    probing,
    probeResults,
    reload: load,
    create,
    update,
    setActive,
    remove,
    probe,
  };
}
