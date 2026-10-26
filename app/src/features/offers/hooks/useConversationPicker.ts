import { useEffect, useState } from 'react';
import { chatService } from '@/services/chat.service';
import type { ChatConversationApiDto } from '@/types/chat.api.types';

const SEARCH_DEBOUNCE_MS = 300;

export interface PickerConversation {
  id: string;
  title: string | null;
  isGroup: boolean;
  sessionName: string | null;
}

const toPicker = (c: ChatConversationApiDto): PickerConversation => ({
  id: c.id,
  title: (c.isGroup ? c.groupName : null) || c.contact?.name || c.contact?.phone || null,
  isGroup: c.isGroup ?? false,
  sessionName: c.session?.name ?? null,
});

/** Conversas do tenant para escolher destinos (reusa `GET /chat/conversations`). Só busca com o diálogo aberto. */
export function useConversationPicker(open: boolean, search: string, onlyGroups: boolean) {
  const [items, setItems] = useState<PickerConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const { conversations } = await chatService.listConversations({
          search: search.trim() || undefined,
          isGroup: onlyGroups ? 'true' : undefined,
        });
        if (!cancelled) setItems(conversations.map(toPicker));
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
  }, [open, search, onlyGroups, attempt]);

  return { items, loading, failed, retry: () => setAttempt((n) => n + 1) };
}
