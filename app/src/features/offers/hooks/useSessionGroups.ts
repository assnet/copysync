import { useEffect, useState } from 'react';
import { offerService } from '@/services/offer.service';
import type { SessionGroupWithSession } from '@/types/api.types';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Grupos de que as sessões participam no WhatsApp (`GET /campaigns/offers/config/groups`,
 * uma chamada por sessão, em paralelo), inclusive os sem mensagem, etiquetados com a sessão.
 * Busca no servidor (sem acento/caixa). Sem sessão, não busca.
 */
export function useSessionGroups(sessionIds: readonly string[], search: string) {
  const [items, setItems] = useState<SessionGroupWithSession[]>([]);
  const [partial, setPartial] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const key = sessionIds.join(',');

  useEffect(() => {
    if (sessionIds.length === 0) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      const results = await Promise.allSettled(
        sessionIds.map((sessionId) => offerService.listSessionGroups(sessionId, search.trim() || undefined)),
      );
      if (cancelled) return;
      const merged: SessionGroupWithSession[] = [];
      let anyPartial = false;
      let anyFailed = false;
      results.forEach((r, i) => {
        if (r.status === 'rejected') { anyFailed = true; return; }
        anyPartial ||= r.value.partial;
        for (const g of r.value.groups) merged.push({ ...g, sessionId: sessionIds[i]! });
      });
      setItems(merged);
      setPartial(anyPartial);
      setFailed(anyFailed && merged.length === 0);
      setLoading(false);
    }, search ? SEARCH_DEBOUNCE_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, search, attempt]);

  return { items, partial, loading, failed, retry: () => setAttempt((n) => n + 1) };
}
