import type { proto } from '@whiskeysockets/baileys';

export const LINK_PREVIEW_TITLE_MAX = 300;
export const LINK_PREVIEW_DESCRIPTION_MAX = 500;
/** Teto da miniatura pequena embutida na mensagem. */
export const LINK_PREVIEW_INLINE_THUMB_MAX_BYTES = 100 * 1024;
/** URL maior que isso é lixo ou abuso: descarta a prévia. */
export const LINK_PREVIEW_URL_MAX = 2048;

export interface InboundLinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  /** JPEG pequeno que veio na mensagem; null se faltou ou não passou na checagem. */
  inlineThumb: Buffer | null;
  /** Miniatura grande no servidor de mídia (`thumbnail-link`); o download decide o chamador. */
  hq: { directPath: string; mediaKey: Uint8Array } | null;
}

/** Corta por caractere (não parte emoji ao meio); vazio vira null. */
function clip(value: string | null | undefined, max: number): string | null {
  const s = value?.trim();
  if (!s) return null;
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() : s;
}

/**
 * Só http/https, sem usuário/senha, host com ponto. O proto não traz `canonicalUrl` (o
 * `canonical-url` do Baileys não vai para a mensagem), então a fonte é o `matchedText`. Sem esquema
 * (`www.x.com`, `amzn.to/x`) recebe `https://`, como o WhatsApp abre. `mailto:`/`javascript:`
 * caem: viram usuário ou porta inválida no parse.
 */
function safeUrl(matchedText: string | null | undefined): string | null {
  const raw = matchedText?.trim();
  if (!raw || raw.length > LINK_PREVIEW_URL_MAX) return null;
  const withScheme = raw.includes('://') ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || !u.hostname.includes('.')) return null;
  return u.href;
}

/** JPEG (FF D8 FF) dentro do teto; qualquer outra coisa é descartada. */
function jpegThumb(bytes: Uint8Array | null | undefined): Buffer | null {
  if (!bytes || bytes.length < 3 || bytes.length > LINK_PREVIEW_INLINE_THUMB_MAX_BYTES) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  return Buffer.from(bytes);
}

/**
 * Prévia de link de uma mensagem recebida, validada (spec P2 AC6). Sem URL válida → null (sem URL
 * não há cartão, mesmo com título). Nunca acessa a URL.
 */
export function pickInboundLinkPreview(ext: proto.Message.IExtendedTextMessage | null | undefined): InboundLinkPreview | null {
  if (!ext) return null;
  const url = safeUrl(ext.matchedText);
  if (!url) return null;
  const directPath = ext.thumbnailDirectPath?.trim();
  const mediaKey = ext.mediaKey;
  return {
    url,
    title: clip(ext.title, LINK_PREVIEW_TITLE_MAX),
    description: clip(ext.description, LINK_PREVIEW_DESCRIPTION_MAX),
    inlineThumb: jpegThumb(ext.jpegThumbnail),
    hq: directPath && mediaKey && mediaKey.length > 0 ? { directPath, mediaKey } : null,
  };
}
