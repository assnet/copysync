import { useCallback, useEffect, useRef, useState } from 'react';
import { adminUsageService } from '@/services/adminUsage.service';
import { USAGE_ERROR_CODES, usageErrorCode } from '../rules';
import type { UsageQuery, UsageTenantItem } from '../types';
import type { UsageReadQueue } from './useUsageDetail';

export interface UsageTenantsState {
  rows: UsageTenantItem[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: boolean;
  slow: boolean;
  moreError: boolean;
  /** Cursor inválido (400 `USAGE_METRICS_CURSOR_INVALID`): lista recarregada do início, com aviso. */
  cursorReset: boolean;
  reload: () => void;
  loadMore: () => void;
}

/**
 * Contas que mais usam o recurso (`GET /admin/usage/features/:key/tenants`). Só lê depois que o detalhe respondeu:
 * `after` é a resposta do detalhe do recorte atual (`null` enquanto ele carrega). Cada resposta nova do detalhe
 * recomeça a lista do início. Página só pelo `nextCursor` opaco (nunca `limit`/`offset`); nada é persistido.
 */
export function useUsageTenants(
  featureKey: string,
  query: UsageQuery,
  after: object | null,
  queue: UsageReadQueue,
): UsageTenantsState {
  const queryKey = JSON.stringify(query);
  const [rows, setRows] = useState<UsageTenantItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [slow, setSlow] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [cursorReset, setCursorReset] = useState(false);
  const request = useRef(0);
  /** Resposta do detalhe à qual a lista atual corresponde (sem ela, a lista ainda está por vir). */
  const [doneFor, setDoneFor] = useState<object | null>(null);
  const afterRef = useRef(after);
  afterRef.current = after;

  const load = useCallback((keepNotice = false) => {
    const id = ++request.current;
    const token = afterRef.current;
    if (!keepNotice) setCursorReset(false);
    setLoadingMore(false);
    setLoading(true);
    setError(false);
    setSlow(false);
    setMoreError(false);
    queue(() => adminUsageService.getTenants(featureKey, JSON.parse(queryKey) as UsageQuery))
      .then((page) => {
        if (id !== request.current) return;
        setRows(page.items);
        setNextCursor(page.nextCursor);
        setDoneFor(token);
      })
      .catch((err: unknown) => {
        if (id !== request.current) return;
        setRows([]);
        setNextCursor(null);
        const isSlow = usageErrorCode(err) === USAGE_ERROR_CODES.readUnavailable;
        setSlow(isSlow);
        setError(!isSlow);
        setDoneFor(token);
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
  }, [featureKey, queryKey, queue]);

  useEffect(() => {
    if (after === null) {
      // Detalhe recarregando: descarta a lista anterior e qualquer resposta dela em voo.
      request.current += 1;
      setRows([]);
      setNextCursor(null);
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    load();
  }, [after, load]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    const id = request.current;
    const cursor = nextCursor;
    setLoadingMore(true);
    setMoreError(false);
    queue(() => adminUsageService.getTenants(featureKey, JSON.parse(queryKey) as UsageQuery, cursor))
      .then((page) => {
        if (id !== request.current) return;
        setRows((prev) => [...prev, ...page.items.filter((t) => !prev.some((p) => p.tenantId === t.tenantId))]);
        setNextCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (id !== request.current) return;
        if (usageErrorCode(err) === USAGE_ERROR_CODES.cursorInvalid) {
          setCursorReset(true);
          load(true);
          return;
        }
        setMoreError(true);
      })
      .finally(() => {
        if (id === request.current) setLoadingMore(false);
      });
  }, [featureKey, queryKey, nextCursor, loadingMore, load, queue]);

  return {
    rows,
    hasMore: nextCursor !== null,
    loading: loading || (after !== null && doneFor !== after),
    loadingMore,
    error,
    slow,
    moreError,
    cursorReset,
    reload: () => load(),
    loadMore,
  };
}
