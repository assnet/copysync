/** Demuxer do ffmpeg (`-f`/`-format_whitelist`) para o formato identificado. */
export type MediaDemuxer = 'mov' | 'matroska' | 'ogg';

/** Tipo real do arquivo, decidido pelo conteúdo. */
export interface SniffedMediaType {
  mimeType: string;
  /** `null` = o arquivo nunca vai ao ffmpeg. */
  demuxer: MediaDemuxer | null;
}

const FALLBACK_MIME_TYPE = 'application/octet-stream';
const OFFICE_MIME_PREFIX = 'application/vnd.openxmlformats';

/** `tipo/subtipo` segundo o RFC 6838 (restricted-name), já em minúsculo. */
const MIME_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

const HEIC_BRANDS = new Set(['heic', 'heix', 'mif1', 'msf1']);

/** `true` se `head` tem exatamente `signature` a partir de `offset` (cabeçalho curto → `false`). */
function hasBytes(head: Uint8Array, offset: number, signature: readonly number[]): boolean {
  if (head.length < offset + signature.length) return false;
  return signature.every((byte, i) => head[offset + i] === byte);
}

function hasAscii(head: Uint8Array, offset: number, text: string): boolean {
  return hasBytes(head, offset, Array.from(text, (ch) => ch.charCodeAt(0)));
}

function readAscii(head: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...head.subarray(start, end));
}

/** Minúsculo, sem parâmetros e só `tipo/subtipo` válido; qualquer outra coisa → `null`. */
function sanitizeDeclaredMimeType(declared: string | null | undefined): string | null {
  if (!declared) return null;
  const essence = declared.split(';', 1)[0].trim().toLowerCase();
  return MIME_TYPE_PATTERN.test(essence) ? essence : null;
}

/** Brands ISO-BMFF (`ftyp`): a principal fica nos bytes 8–11. */
function sniffIsoBmff(brand: string): SniffedMediaType {
  if (HEIC_BRANDS.has(brand)) return { mimeType: 'image/heic', demuxer: null };
  if (brand.startsWith('3gp')) return { mimeType: 'video/3gpp', demuxer: 'mov' };
  if (brand === 'qt  ') return { mimeType: 'video/quicktime', demuxer: 'mov' };
  if (brand === 'M4A ') return { mimeType: 'audio/mp4', demuxer: 'mov' };
  return { mimeType: 'video/mp4', demuxer: 'mov' };
}

/**
 * Identifica o tipo do arquivo pelos primeiros bytes (magic bytes).
 *
 * O MIME do navegador é só dica: a assinatura sempre prevalece. Exceções:
 * - ZIP declarado como Office (`application/vnd.openxmlformats*`) mantém o declarado,
 *   já que docx/xlsx/pptx são ZIP por dentro
 * - sem assinatura conhecida, vale o declarado saneado ou `application/octet-stream`,
 *   e o demuxer é sempre `null` — conteúdo não identificado nunca vai ao ffmpeg
 */
export function sniffMediaType(head: Uint8Array, declaredMimeType?: string | null): SniffedMediaType {
  if (hasBytes(head, 0, [0xff, 0xd8, 0xff])) return { mimeType: 'image/jpeg', demuxer: null };
  if (hasBytes(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: 'image/png', demuxer: null };
  }
  if (hasAscii(head, 0, 'RIFF') && hasAscii(head, 8, 'WEBP')) return { mimeType: 'image/webp', demuxer: null };
  if (hasAscii(head, 0, 'GIF87a') || hasAscii(head, 0, 'GIF89a')) return { mimeType: 'image/gif', demuxer: null };
  if (hasAscii(head, 4, 'ftyp')) return sniffIsoBmff(readAscii(head, 8, 12));
  if (hasBytes(head, 0, [0x1a, 0x45, 0xdf, 0xa3])) return { mimeType: 'video/webm', demuxer: 'matroska' };
  if (hasAscii(head, 0, 'OggS')) return { mimeType: 'audio/ogg', demuxer: 'ogg' };
  if (hasAscii(head, 0, '%PDF-')) return { mimeType: 'application/pdf', demuxer: null };

  const declared = sanitizeDeclaredMimeType(declaredMimeType);
  if (hasBytes(head, 0, [0x50, 0x4b, 0x03, 0x04])) {
    return { mimeType: declared?.startsWith(OFFICE_MIME_PREFIX) ? declared : 'application/zip', demuxer: null };
  }
  return { mimeType: declared ?? FALLBACK_MIME_TYPE, demuxer: null };
}
