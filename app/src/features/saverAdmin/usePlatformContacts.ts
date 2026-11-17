import { useCallback, useEffect, useRef, useState } from 'react';
import { saverAdminService } from '@/services/saverAdmin.service';
import { isInvalidCursorError, platformErrorMessage } from './errors';
import type { PlatformContact, PlatformContactFilters } from './types';

export interface PlatformContactsState {
  items: PlatformContact[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /** A última "carregar mais" teve cursor recusado e a lista recomeçou. */
  restarted: boolean;
  reload: () => void;
  loadMore: () => void;
}

/**
 * Lista da base por cursor assinado. Dado do servidor: nunca persistido. Trocar filtro (chave) descarta a
 * lista e busca a 1ª página; "carregar mais" manda os mesmos filtros + só o `nextCursor`. Cursor inválido
 * (400) recomeça da 1ª página. Resposta de uma busca antiga é descartada pelo `seq`.
 */
export function usePlatformContacts(filters: PlatformContactFilters): PlatformContactsState {
  const [items, setItems] = useState<PlatformContact[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restarted, setRestarted] = useState(false);
  const seq = useRef(0);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const key = JSON.stringify(filters);

  const loadFirst = useCallback(async (afterRestart = false) => {
    const mine = ++seq.current;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setRestarted(afterRestart);
    setItems([]);
    setNextCursor(null);
    try {
      const page = await saverAdminService.listContacts(filtersRef.current, null);
      if (mine !== seq.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (mine === seq.current) setError(platformErrorMessage(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFirst();
    return () => { seq.current++; };
  }, [key, loadFirst]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore || loading) return;
    const mine = seq.current;
    const cursor = nextCursor;
    setLoadingMore(true);
    setRestarted(false);
    saverAdminService.listContacts(filtersRef.current, cursor).then(
      (page) => {
        if (mine !== seq.current) return;
        setItems((prev) => {
          const seen = new Set(prev.map((c) => c.id));
          return [...prev, ...page.items.filter((c) => !seen.has(c.id))];
        });
        setNextCursor(page.nextCursor);
        setLoadingMore(false);
      },
      (err: unknown) => {
        if (mine !== seq.current) return;
        if (isInvalidCursorError(err)) {
          void loadFirst(true);
          return;
        }
        setLoadingMore(false);
        setError(platformErrorMessage(err));
      },
    );
  }, [nextCursor, loadingMore, loading, loadFirst]);

  const reload = useCallback(() => { void loadFirst(); }, [loadFirst]);

  return { items, nextCursor, loading, loadingMore, error, restarted, reload, loadMore };
}
