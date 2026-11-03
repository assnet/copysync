import type { ChatMessageLinkPreview } from '../entities/ChatMessage';

/** Prévia vinda do evento/histórico (campos opcionais) → prévia da mensagem (campos null). */
export function toChatLinkPreview(p: {
  url: string;
  title: string | null;
  description?: string | null;
  thumbnailUrl?: string | null;
} | null | undefined): ChatMessageLinkPreview | null {
  if (!p) return null;
  return {
    url: p.url,
    title: p.title,
    description: p.description ?? null,
    thumbnailUrl: p.thumbnailUrl ?? null,
  };
}
