/** Demuxer do ffmpeg (`-f`/`-format_whitelist`) para o formato identificado. */
export type MediaDemuxer = 'mov' | 'matroska' | 'ogg';

interface SniffedMediaTypeBase {
  mimeType: string;
  /** `null` = o arquivo nunca vai ao ffmpeg. */
  demuxer: MediaDemuxer | null;
}

/**
 * Tipo real do arquivo, decidido pelo conteúdo.
 *
 * `generic: true` só no fallback do `ftyp` (brand desconhecida): o `video/mp4` é palpite para o
 * ffprobe confirmar, não assinatura — por isso leva junto o declarado saneado, que é o rótulo
 * do documento quando o palpite não se confirma (`classifyOutboundMedia`).
 */
export type SniffedMediaType =
  | (SniffedMediaTypeBase & { generic?: false })
  | (SniffedMediaTypeBase & { generic: true; declaredMimeType: string | null });

const FALLBACK_MIME_TYPE = 'application/octet-stream';
const OFFICE_MIME_PREFIX = 'application/vnd.openxmlformats';

/**
 * `tipo/subtipo` já em minúsculo. O tipo segue o RFC 6838 (restricted-name); o subtipo é mais
 * estrito — sem `!#$&^_` — porque vira extensão do arquivo e parte da URL (`mimeTypeToExt`).
 */
const MIME_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9.+-]{0,126}$/;

const HEIC_BRANDS = new Set(['heic', 'heix', 'mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);
/** Brands registradas de MP4 (mp4ra.org) — fora delas, `video/mp4` é só palpite. */
const MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VH', 'M4VP', 'dash', 'mmp4', 'f4v ',
]);

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

/**
 * Brands ISO-BMFF (`ftyp`): a principal fica nos bytes 8–11. Brand desconhecida (ou cortada)
 * vai ao ffprobe como MP4 — um vídeo de brand rara ainda sai inline se o codec confirmar —,
 * mas marcada como genérica: sem confirmação, não é rotulada como vídeo.
 */
function sniffIsoBmff(brand: string, declared: string | null): SniffedMediaType {
  if (HEIC_BRANDS.has(brand)) return { mimeType: 'image/heic', demuxer: null };
  if (AVIF_BRANDS.has(brand)) return { mimeType: 'image/avif', demuxer: null };
  if (brand.startsWith('3gp')) return { mimeType: 'video/3gpp', demuxer: 'mov' };
  if (brand === 'qt  ') return { mimeType: 'video/quicktime', demuxer: 'mov' };
  if (brand === 'M4A ') return { mimeType: 'audio/mp4', demuxer: 'mov' };
  if (MP4_BRANDS.has(brand)) return { mimeType: 'video/mp4', demuxer: 'mov' };
  return { mimeType: 'video/mp4', demuxer: 'mov', generic: true, declaredMimeType: declared };
}

/**
 * Identifica o tipo do arquivo pelos primeiros bytes (magic bytes).
 *
 * O MIME do navegador é só dica: a assinatura sempre prevalece. Exceções:
 * - ZIP declarado como Office (`application/vnd.openxmlformats*`) mantém o declarado,
 *   já que docx/xlsx/pptx são ZIP por dentro
 * - `ftyp` de brand desconhecida sai `generic: true` com o declarado saneado ao lado
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
  const declared = sanitizeDeclaredMimeType(declaredMimeType);
  if (hasAscii(head, 4, 'ftyp')) return sniffIsoBmff(readAscii(head, 8, 12), declared);
  if (hasBytes(head, 0, [0x1a, 0x45, 0xdf, 0xa3])) return { mimeType: 'video/webm', demuxer: 'matroska' };
  if (hasAscii(head, 0, 'OggS')) return { mimeType: 'audio/ogg', demuxer: 'ogg' };
  if (hasAscii(head, 0, '%PDF-')) return { mimeType: 'application/pdf', demuxer: null };

  if (hasBytes(head, 0, [0x50, 0x4b, 0x03, 0x04])) {
    return { mimeType: declared?.startsWith(OFFICE_MIME_PREFIX) ? declared : 'application/zip', demuxer: null };
  }
  return { mimeType: declared ?? FALLBACK_MIME_TYPE, demuxer: null };
}
