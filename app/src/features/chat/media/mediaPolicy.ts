/**
 * Política de anexos no painel: espelho da classificação da API (design §6) **sem probe**.
 *
 * O painel só sabe tipo e tamanho, então serve para avisar e bloquear antes do upload. A API é a
 * autoridade: ela lê o conteúdo e o codec — um MP4 HEVC passa aqui como vídeo e vira documento
 * só lá; a resposta do envio traz o tipo final e a bolha reflete.
 */
import type { MediaUploadConfigDto, MediaUploadPurpose } from '@/types/media.api.types';

/** De onde veio o anexo: "Fotos e vídeos", "Documento" ou arrastar/colar. */
export type AttachmentOrigin = 'media' | 'document' | 'auto';

export type AttachmentKind = 'image' | 'video' | 'document';

export interface AttachmentFile {
  name: string;
  type: string;
  size: number;
}

export interface AttachmentClassification {
  kind: AttachmentKind;
  purpose: MediaUploadPurpose;
  /** Foto/vídeo que vai como documento — a prévia avisa. */
  convertedToDocument: boolean;
  blocked: null | 'empty' | 'too_large';
  /** Limite do tipo final, para a mensagem de bloqueio. */
  limitBytes: number;
}

export type BatchValidation = { ok: true } | { ok: false; reason: 'too_many'; max: number };

const INLINE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const INLINE_VIDEO_TYPES = new Set(['video/mp4', 'video/3gpp']);

/** Alguns navegadores deixam `type` vazio (ex.: HEIC); deduz pela extensão. */
const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

function resolveType(file: AttachmentFile): string {
  if (file.type) return file.type;
  const dot = file.name.lastIndexOf('.');
  const extension = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  return TYPE_BY_EXTENSION[extension] ?? '';
}

export function classifyAttachment(
  file: AttachmentFile,
  origin: AttachmentOrigin,
  config: MediaUploadConfigDto,
): AttachmentClassification {
  const { limits } = config;
  const type = resolveType(file);
  const isVisual = type.startsWith('image/') || type.startsWith('video/');
  const empty = file.size === 0 ? ('empty' as const) : null;

  if (origin !== 'document' && isVisual) {
    const inline = (kind: 'image' | 'video', limitBytes: number): AttachmentClassification => ({
      kind,
      purpose: 'media',
      convertedToDocument: false,
      blocked: empty,
      limitBytes,
    });
    if (INLINE_IMAGE_TYPES.has(type) && file.size <= limits.imageBytes) return inline('image', limits.imageBytes);
    if (INLINE_VIDEO_TYPES.has(type) && file.size <= limits.inlineVideoBytes) {
      return inline('video', limits.inlineVideoBytes);
    }
  }

  // Foto/vídeo fora da regra segue com finalidade `media` para a API decidir a conversão; o que
  // não é foto nem vídeo sobe como documento (em "Fotos e vídeos" ainda avisa que mudou de tipo).
  const purpose: MediaUploadPurpose = origin !== 'document' && isVisual ? 'media' : 'document';
  const tooLarge = file.size > limits.documentBytes ? ('too_large' as const) : null;
  return {
    kind: 'document',
    purpose,
    convertedToDocument: origin === 'media' || (origin === 'auto' && isVisual),
    blocked: empty ?? tooLarge,
    limitBytes: limits.documentBytes,
  };
}

export function validateBatch(count: number, config: MediaUploadConfigDto): BatchValidation {
  const max = config.maxFilesPerBatch;
  return count > max ? { ok: false, reason: 'too_many', max } : { ok: true };
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;
const numberLabel = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** Rótulo decimal curto (base 1000, como os limites do servidor): `180 MB`, `1,5 GB`. */
export function formatBytesLabel(bytes: number): string {
  let value = bytes;
  let unit = 0;
  // Compara já arredondado: 999.999 bytes vira "1 MB", não "1.000 KB".
  while (unit < BYTE_UNITS.length - 1 && Math.round(value * 10) / 10 >= 1000) {
    value /= 1000;
    unit += 1;
  }
  return `${numberLabel.format(value)} ${BYTE_UNITS[unit]}`;
}
