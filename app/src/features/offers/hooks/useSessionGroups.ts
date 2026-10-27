import { useEffect, useState } from 'react';
import { offerService } from '@/services/offer.service';
import type { SessionGroupItem } from '@/types/api.types';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Grupos de que a sessão participa no WhatsApp (`GET /campaigns/offers/config/groups`), inclusive
 * os sem mensagem. Busca no servidor (sem acento/caixa). Sem sessão, não busca.
 */
export function useSessionGroups(sessionId: string | null, search: string) {
  const [items, setItems] = useState<SessionGroupItem[]>([]);
  const [partial, setPartial] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const result = await offerService.listSessionGroups(sessionId, search.trim() || undefined);
        if (!cancelled) {
          setItems(result.groups);
          setPartial(result.partial);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, search ? SEARCH_DEBOUNCE_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, search, attempt]);

  return { items, partial, loading, failed, retry: () => setAttempt((n) => n + 1) };
}
