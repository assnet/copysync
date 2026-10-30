import { useCallback, useEffect, useRef, useState } from 'react';
import { monitoringService } from '@/services/monitoring.service';
import { serverNow } from '@/services/serverClock';
import type { CapturedOfferItem } from '@/types/api.types';
import { RETRYABLE_REASONS } from '../utils/settingsDraft';

/** Atualiza a 1ª página enquanto o usuário não pediu mais páginas (não embaralha o que ele lê). */
const POLL_MS = 30_000;

/** Filtro da lista. A API não filtra por status: vale sobre as páginas já carregadas. */
export type CapturedFilter = 'all' | 'action' | 'queued' | 'working' | 'skipped';
export const CAPTURED_FILTERS: readonly CapturedFilter[] = ['all', 'action', 'queued', 'working', 'skipped'];

/** SKIPPED/FAILED cuja causa o usuário pode corrigir: vale "Tentar de novo". */
export function canRetryCaptured(item: Pick<CapturedOfferItem, 'status' | 'reason'>): boolean {
  return (item.status === 'SKIPPED' || item.status === 'FAILED')
    && item.reason !== null
    && (RETRYABLE_REASONS as readonly string[]).includes(item.reason);
}

export function matchesCapturedFilter(item: Pick<CapturedOfferItem, 'status' | 'reason'>, filter: CapturedFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'action': return canRetryCaptured(item);
    case 'queued': return item.status === 'QUEUED';
    case 'working': return item.status === 'PENDING' || item.status === 'PROCESSING';
    // Não enviada e sem como recuperar (inclui FAILED sem motivo recuperável): os filtros somam o total
    case 'skipped': return (item.status === 'SKIPPED' || item.status === 'FAILED') && !canRetryCaptured(item);
    default: return true;
  }
}

export function countCapturedByFilter(items: readonly Pick<CapturedOfferItem, 'status' | 'reason'>[]): Record<CapturedFilter, number> {
  const counts: Record<CapturedFilter, number> = { all: 0, action: 0, queued: 0, working: 0, skipped: 0 };
  for (const item of items) {
    for (const f of CAPTURED_FILTERS) if (matchesCapturedFilter(item, f)) counts[f] += 1;
  }
  return counts;
}

/** Ofertas capturadas da sessão, paginadas pelo cursor opaco da API. */
export function useCapturedOffers(sessionId: string | null) {
  const [items, setItems] = useState<CapturedOfferItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pages, setPages] = useState(1);
  /** Hora do servidor (ms) da última atualização bem-sucedida da 1ª página. */
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  /** Ofertas que o polling trouxe desde a última atualização pedida pelo usuário. */
  const [newSinceLastView, setNewSinceLastView] = useState(0);
  const current = useRef(sessionId);
  current.current = sessionId;
  // Ids já vistos na última atualização manual (ou na 1ª carga)
  const seen = useRef<Set<string> | null>(null);

  // Requisição da 1ª página em voo (por sessão): o polling e o botão não se sobrepõem
  const inFlight = useRef<string | null>(null);
  // Geração da lista: sobe no refresh manual, no "carregar mais" e na troca de sessão. Resposta de
  // uma geração antiga é descartada (polling que volta depois do "carregar mais" não encolhe a lista).
  const generation = useRef(0);
  // "Atualizar" pedido com polling em voo: descarta o polling e roda o manual quando ele voltar
  const pendingManual = useRef(false);

  const load = useCallback(async (manual: boolean) => {
    if (!sessionId) return;
    if (inFlight.current === sessionId) {
      if (manual) {
        generation.current += 1;
        pendingManual.current = true;
      }
      return;
    }
    inFlight.current = sessionId;
    if (manual) generation.current += 1;
    const gen = generation.current;
    setLoading(true);
    setFailed(false);
    try {
      const page = await monitoringService.listCaptured(sessionId);
      if (current.current !== sessionId || generation.current !== gen) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setPages(1);
      setLastUpdatedAt(serverNow());
      if (manual || !seen.current) {
        seen.current = new Set(page.items.map((i) => i.id));
        setNewSinceLastView(0);
      } else {
        const known = seen.current;
        setNewSinceLastView(page.items.filter((i) => !known.has(i.id)).length);
      }
    } catch {
      if (current.current === sessionId && generation.current === gen) setFailed(true);
    } finally {
      if (inFlight.current === sessionId) inFlight.current = null;
      if (current.current === sessionId) setLoading(false);
      if (pendingManual.current && current.current === sessionId) {
        pendingManual.current = false;
        void load(true);
      }
    }
  }, [sessionId]);

  const refresh = useCallback(() => load(true), [load]);

  const loadMore = useCallback(async () => {
    if (!sessionId || !nextCursor) return;
    generation.current += 1;
    const gen = generation.current;
    setLoadingMore(true);
    try {
      const page = await monitoringService.listCaptured(sessionId, nextCursor);
      if (current.current !== sessionId || generation.current !== gen) return;
      // Invalida o polling que saiu enquanto esta página carregava
      generation.current += 1;
      setItems((prev) => {
        const ids = new Set(prev.map((i) => i.id));
        return [...prev, ...page.items.filter((i) => !ids.has(i.id))];
      });
      setNextCursor(page.nextCursor);
      setPages((n) => n + 1);
    } catch {
      if (current.current === sessionId && generation.current === gen) setFailed(true);
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
    setLastUpdatedAt(null);
    setNewSinceLastView(0);
    seen.current = null;
    pendingManual.current = false;
    setPages(1);
    void load(true);
  }, [load]);

  useEffect(() => {
    if (!sessionId || pages > 1) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load(false);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [sessionId, pages, load]);

  return { items, nextCursor, loading, loadingMore, failed, refresh, loadMore, retry, lastUpdatedAt, newSinceLastView };
}
