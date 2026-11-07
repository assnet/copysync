import { useCallback, useEffect, useRef, useState } from 'react';
import { adminRedirectLinksService } from '@/services/adminRedirectLinks.service';
import { redirectLinkErrorMessage } from '../errors';
import type { CreateRedirectLinkRequest, RedirectLink, UpdateRedirectLinkRequest } from '../types';

const bySlug = (a: RedirectLink, b: RedirectLink) => a.slug.localeCompare(b.slug);

/**
 * Estado local da tela de links (sem store global).
 * - ativo/desativado é otimista, com rollback e `actionError`
 * - criar/editar não é otimista: o diálogo recebe o erro e fica aberto
 */
export function useAdminRedirectLinks() {
  const [links, setLinks] = useState<RedirectLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const linksRef = useRef(links);
  linksRef.current = links;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setLinks([...(await adminRedirectLinksService.list())].sort(bySlug));
    } catch (err) {
      setLoadError(redirectLinkErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replace = (item: RedirectLink) =>
    setLinks((prev) => prev.map((l) => (l.id === item.id ? item : l)).sort(bySlug));
  const flag = (id: string, v: boolean) => setBusy((prev) => ({ ...prev, [id]: v }));

  const create = useCallback(async (body: CreateRedirectLinkRequest) => {
    const item = await adminRedirectLinksService.create(body);
    setLinks((prev) => [...prev, item].sort(bySlug));
    return item;
  }, []);

  const update = useCallback(async (id: string, body: UpdateRedirectLinkRequest) => {
    const item = await adminRedirectLinksService.update(id, body);
    replace(item);
    return item;
  }, []);

  const setActive = useCallback(async (id: string, isActive: boolean) => {
    const previous = linksRef.current.find((l) => l.id === id);
    if (!previous) return;
    replace({ ...previous, isActive });
    flag(id, true);
    try {
      replace(await adminRedirectLinksService.update(id, { isActive }));
    } catch (err) {
      replace(previous);
      setActionError(redirectLinkErrorMessage(err));
    } finally {
      flag(id, false);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    flag(id, true);
    try {
      await adminRedirectLinksService.remove(id);
      setLinks((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      setActionError(redirectLinkErrorMessage(err));
    } finally {
      flag(id, false);
    }
  }, []);

  return {
    links,
    loading,
    loadError,
    actionError,
    clearActionError: () => setActionError(null),
    busy,
    reload: load,
    create,
    update,
    setActive,
    remove,
  };
}
