import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import { MediaTooLargeError, UnsupportedMediaTypeError } from '../../../../shared/errors/internal/MediaErrors';
import type { MediaProbe } from './parseProbeOutput';
import type { SniffedMediaType } from './sniffMediaType';

/** O que o operador escolheu no menu de anexo. */
export type OutboundMediaPurpose = 'media' | 'document' | 'voice';

/** Como o anexo vai de fato para o WhatsApp. */
export type OutboundMediaKind = 'image' | 'video' | 'voice' | 'document';

/** Limites em bytes por tipo final (vêm da config; o teste passa os dele). */
export interface OutboundMediaLimits {
  imageBytes: number;
  inlineVideoBytes: number;
  documentBytes: number;
  voiceBytes: number;
}

export interface ClassifyOutboundMediaInput {
  purpose: OutboundMediaPurpose;
  sniffed: SniffedMediaType;
  sizeBytes: number;
  /** `null` = sem ffmpeg ou arquivo que não vai ao ffmpeg. */
  probe: MediaProbe | null;
  limits: OutboundMediaLimits;
}

export interface OutboundMediaClassification {
  kind: OutboundMediaKind;
  mimeType: string;
  /** Presente quando "fotos e vídeos" virou documento — o painel avisa o operador. */
  reason?: 'converted_to_document';
}

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const INLINE_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/3gpp']);
const VOICE_SOURCE_MIME_TYPES = new Set(['audio/ogg', 'video/webm', 'audio/mp4', 'video/mp4']);

/** Formato final da nota de voz; quem produz o arquivo é o transcode. */
const VOICE_MIME_TYPE = 'audio/ogg; codecs=opus';
const UNKNOWN_DOCUMENT_MIME_TYPE = 'application/octet-stream';

/**
 * Rótulo do arquivo que sai como documento. O `video/mp4` do `ftyp` genérico é palpite, não
 * assinatura: rotulado assim, um arquivo de brand desconhecida (raw de câmera, por exemplo)
 * chegaria ao contato como vídeo e com extensão `.mp4`. Vale o declarado saneado.
 */
function documentMimeType(sniffed: SniffedMediaType): string {
  return sniffed.generic ? sniffed.declaredMimeType ?? UNKNOWN_DOCUMENT_MIME_TYPE : sniffed.mimeType;
}

function ensureWithinLimit(sizeBytes: number, limitBytes: number, kind: OutboundMediaKind): void {
  if (sizeBytes > limitBytes) {
    throw new MediaTooLargeError('Media exceeds the allowed size for its type', { limitBytes, kind });
  }
}

/** Voz sempre passa pelo ffmpeg: sem probe não há como garantir que existe áudio. */
function classifyVoice({ sniffed, sizeBytes, probe, limits }: ClassifyOutboundMediaInput): OutboundMediaClassification {
  if (!VOICE_SOURCE_MIME_TYPES.has(sniffed.mimeType) || !probe?.hasAudio) {
    throw new UnsupportedMediaTypeError('Voice notes must be an audio recording', { mimeType: sniffed.mimeType });
  }
  ensureWithinLimit(sizeBytes, limits.voiceBytes, 'voice');
  return { kind: 'voice', mimeType: VOICE_MIME_TYPE };
}

/**
 * Vídeo inline só em H.264 8 bits (`yuv420p`) dentro de MP4/3GP: é o que toca em todo aparelho.
 * Sem probe o codec é desconhecido (HEVC tocaria mal), então não entra inline — e o `ftyp`
 * genérico, sem probe, nem é certeza de vídeo: só o codec confirmado o faz sair como vídeo.
 */
function isInlineVideo(sniffed: SniffedMediaType, probe: MediaProbe | null): boolean {
  return (
    INLINE_VIDEO_MIME_TYPES.has(sniffed.mimeType) &&
    probe?.videoCodec === 'h264' &&
    probe.pixelFormat === 'yuv420p'
  );
}

function classifyMedia({ sniffed, sizeBytes, probe, limits }: ClassifyOutboundMediaInput): OutboundMediaClassification {
  if (IMAGE_MIME_TYPES.has(sniffed.mimeType) && sizeBytes <= limits.imageBytes) {
    return { kind: 'image', mimeType: sniffed.mimeType };
  }
  if (isInlineVideo(sniffed, probe) && sizeBytes <= limits.inlineVideoBytes) {
    return { kind: 'video', mimeType: sniffed.mimeType };
  }
  ensureWithinLimit(sizeBytes, limits.documentBytes, 'document');
  return { kind: 'document', mimeType: documentMimeType(sniffed), reason: 'converted_to_document' };
}

/**
 * Decide como um anexo sai (tabela do design §6). O tipo vem do conteúdo (`sniffMediaType`),
 * nunca do que o navegador declarou. Em "fotos e vídeos", o que não pode ir inline vira
 * documento com `reason: 'converted_to_document'` — sem transcodificar vídeo.
 *
 * @throws {ValidationError} arquivo vazio
 * @throws {UnsupportedMediaTypeError} voz que não é gravação de áudio
 * @throws {MediaTooLargeError} acima do limite do tipo final (`meta`: `limitBytes`, `kind`)
 */
export function classifyOutboundMedia(input: ClassifyOutboundMediaInput): OutboundMediaClassification {
  if (input.sizeBytes <= 0) {
    throw new ValidationError('Media file is empty', { sizeBytes: input.sizeBytes });
  }
  if (input.purpose === 'voice') return classifyVoice(input);
  if (input.purpose === 'media') return classifyMedia(input);

  ensureWithinLimit(input.sizeBytes, input.limits.documentBytes, 'document');
  return { kind: 'document', mimeType: documentMimeType(input.sniffed) };
}
