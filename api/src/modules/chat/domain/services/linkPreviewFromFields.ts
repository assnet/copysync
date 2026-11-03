import type { ChatMessageLinkPreview } from '../entities/ChatMessage';

/** Colunas planas → prévia agrupada. Sem URL e sem título não há cartão: null. */
export function linkPreviewFromFields(f: {
  linkPreviewUrl: string | null;
  linkPreviewTitle: string | null;
  linkPreviewDescription: string | null;
  linkPreviewThumbUrl: string | null;
}): ChatMessageLinkPreview | null {
  if (!f.linkPreviewUrl && !f.linkPreviewTitle) return null;
  return {
    url: f.linkPreviewUrl,
    title: f.linkPreviewTitle,
    description: f.linkPreviewDescription,
    thumbnailUrl: f.linkPreviewThumbUrl,
  };
}
