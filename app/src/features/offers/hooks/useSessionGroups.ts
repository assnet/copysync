import { useEffect, useState } from 'react';
import { chatService } from '@/services/chat.service';
import type { ChatConversationApiDto } from '@/types/chat.api.types';

const SEARCH_DEBOUNCE_MS = 300;

export interface SessionGroup {
  id: string;
  title: string | null;
}

const toGroup = (c: ChatConversationApiDto): SessionGroup => ({
  id: c.id,
  title: c.groupName || c.contact?.name || null,
});

/** Grupos de uma sessão (reusa `GET /chat/conversations?isGroup=true&sessionId=`). Sem sessão, não busca. */
export function useSessionGroups(sessionId: string | null, search: string) {
  const [items, setItems] = useState<SessionGroup[]>([]);
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
        const { conversations } = await chatService.listConversations({
          sessionId,
          isGroup: 'true',
          search: search.trim() || undefined,
        });
        if (!cancelled) setItems(conversations.filter((c) => c.isGroup !== false).map(toGroup));
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

  return { items, loading, failed, retry: () => setAttempt((n) => n + 1) };
}
