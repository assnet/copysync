import { useCallback, useEffect, useRef, useState } from 'react';
import { offerHunterService } from '@/services/offerHunter.service';
import type { HuntFind, HuntPage, HuntRun } from '../types';
import { huntErrorCode } from './useHuntResource';

const CURSOR_INVALID = 'OFFER_HUNT_CURSOR_INVALID';

export interface HuntPagedList<T> {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  errorCode: string | null;
  /** Próxima página pelo cursor opaco do servidor. Cursor vencido (400) recomeça do início. */
  loadMore: () => Promise<void>;
  /** Recomeça do início (após rodar/aprovar). */
  reload: () => Promise<void>;
  /** Troca um item local após uma mutação. */
  replaceItem: (item: T) => void;
}

/**
 * Lista paginada por cursor (dado sensível pagina no servidor: o front só devolve `nextCursor`,
 * nunca `limit`/`offset`). Troca de `huntId` recomeça; resposta antiga é descartada.
 */
export function useHuntPagedList<T extends { id: string }>(
  huntId: string | null | undefined,
  fetchPage: (huntId: string, cursor: string | null) => Promise<HuntPage<T>>,
): HuntPagedList<T> {
  const id = huntId || null;
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(id !== null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!id) return;
    const mine = ++seq.current;
    setLoading(true);
    // loadMore em voo fica obsoleto (seq mudou) e não zera a flag: zera aqui
    setLoadingMore(false);
    setErrorCode(null);
    try {
      const page = await fetchRef.current(id, null);
      if (mine !== seq.current) return;
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (err) {
      if (mine === seq.current) setErrorCode(huntErrorCode(err) ?? 'UNKNOWN');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [id]);

  const loadMore = useCallback(async () => {
    if (!id || !cursor || loadingMore) return;
    const mine = seq.current;
    setLoadingMore(true);
    setErrorCode(null);
    try {
      const page = await fetchRef.current(id, cursor);
      if (mine !== seq.current) return;
      // Sem duplicar item que já entrou (lista mudou entre as páginas)
      setItems((cur) => {
        const seen = new Set(cur.map((x) => x.id));
        return [...cur, ...page.items.filter((x) => !seen.has(x.id))];
      });
      setCursor(page.nextCursor);
    } catch (err) {
      if (mine !== seq.current) return;
      const code = huntErrorCode(err);
      if (code === CURSOR_INVALID) {
        void reload();
        return;
      }
      setErrorCode(code ?? 'UNKNOWN');
    } finally {
      if (mine === seq.current) setLoadingMore(false);
    }
  }, [id, cursor, loadingMore, reload]);

  const replaceItem = useCallback((item: T) => {
    setItems((cur) => cur.map((x) => (x.id === item.id ? item : x)));
  }, []);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setLoadingMore(false);
    void reload();
    return () => { seq.current++; };
  }, [reload]);

  return { items, loading, loadingMore, hasMore: cursor !== null, errorCode, loadMore, reload, replaceItem };
}

/** `GET /:id/runs` (histórico de execuções, mais recente primeiro). */
export function useHuntRuns(huntId: string | null | undefined): HuntPagedList<HuntRun> {
  return useHuntPagedList(huntId, offerHunterService.listRuns);
}

/**
 * `GET /:id/finds` + aprovar/dispensar (modo `REVIEW`) e reenviar achado já entregue. As mutações trocam o item local e rejeitam
 * com o erro do `apiClient` (409 `OFFER_HUNT_FIND_INVALID_STATE` = já decidido: recarregar).
 */
export function useHuntFinds(huntId: string | null | undefined) {
  const list = useHuntPagedList(huntId, offerHunterService.listFinds);
  const { replaceItem } = list;
  const [busyFindId, setBusyFindId] = useState<string | null>(null);

  const decide = useCallback(async (findId: string, fn: () => Promise<HuntFind>) => {
    setBusyFindId(findId);
    try {
      const find = await fn();
      replaceItem(find);
      return find;
    } finally {
      setBusyFindId((cur) => (cur === findId ? null : cur));
    }
  }, [replaceItem]);

  const approve = useCallback(
    (findId: string) => decide(findId, async () => (await offerHunterService.approveFind(findId)).find),
    [decide],
  );
  const dismiss = useCallback((findId: string) => decide(findId, () => offerHunterService.dismissFind(findId)), [decide]);
  /** Reenvio de achado já entregue: o item volta com o disparo novo ("Na fila de envio"). */
  const resend = useCallback((findId: string) => decide(findId, () => offerHunterService.resendFind(findId)), [decide]);

  return { ...list, busyFindId, approve, dismiss, resend };
}
