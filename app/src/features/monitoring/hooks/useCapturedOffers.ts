import { useCallback, useEffect, useRef, useState } from 'react';
import { monitoringService } from '@/services/monitoring.service';
import type { CapturedOfferItem } from '@/types/api.types';

/** Atualiza a 1ª página enquanto o usuário não pediu mais páginas (não embaralha o que ele lê). */
const POLL_MS = 30_000;

/** Ofertas capturadas da sessão, paginadas pelo cursor opaco da API. */
export function useCapturedOffers(sessionId: string | null) {
  const [items, setItems] = useState<CapturedOfferItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pages, setPages] = useState(1);
  const current = useRef(sessionId);
  current.current = sessionId;

  // Requisição da 1ª página em voo (por sessão): o polling e o botão não se sobrepõem
  const inFlight = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId || inFlight.current === sessionId) return;
    inFlight.current = sessionId;
    setLoading(true);
    setFailed(false);
    try {
      const page = await monitoringService.listCaptured(sessionId);
      if (current.current !== sessionId) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setPages(1);
    } catch {
      if (current.current === sessionId) setFailed(true);
    } finally {
      if (inFlight.current === sessionId) inFlight.current = null;
      if (current.current === sessionId) setLoading(false);
    }
  }, [sessionId]);

  const loadMore = useCallback(async () => {
    if (!sessionId || !nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await monitoringService.listCaptured(sessionId, nextCursor);
      if (current.current !== sessionId) return;
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...page.items.filter((i) => !seen.has(i.id))];
      });
      setNextCursor(page.nextCursor);
      setPages((n) => n + 1);
    } catch {
      if (current.current === sessionId) setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [sessionId, nextCursor]);

  /** Reprocessa uma oferta; troca o item na lista pelo devolvido. Lança em erro. */
  const retry = useCallback(async (id: string) => {
    const updated = await monitoringService.retryCaptured(id);
    setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
    return updated;
  }, []);

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!sessionId || pages > 1) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [sessionId, pages, refresh]);

  return { items, nextCursor, loading, loadingMore, failed, refresh, loadMore, retry };
}
