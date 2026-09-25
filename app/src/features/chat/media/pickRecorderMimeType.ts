/**
 * Formato do `MediaRecorder` para a nota de voz (design §14, "Gravador").
 *
 * Ogg/Opus primeiro (já é o formato final da nota de voz), depois WebM/Opus (Chrome, Edge)
 * e MP4 (Safari). A API converte o que chegar para Ogg/Opus mono.
 */
const RECORDER_MIME_CANDIDATES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'] as const;

export type RecorderFileExtension = 'ogg' | 'webm' | 'm4a';

/**
 * Primeiro formato suportado; nenhum → `''` (o navegador escolhe o padrão dele).
 * Recebe o teste de suporte para ficar puro — no painel, `MediaRecorder.isTypeSupported`.
 */
export function pickRecorderMimeType(isTypeSupported: (type: string) => boolean): string {
  return RECORDER_MIME_CANDIDATES.find((type) => isTypeSupported(type)) ?? '';
}

/** Extensão do arquivo pelo `mimeType` que o gravador realmente usou; desconhecido → `webm`. */
export function extensionForRecorderMime(mime: string): RecorderFileExtension {
  // O navegador pode devolver parâmetros com espaço ou maiúsculas ("audio/ogg; codecs=opus").
  const base = mime.split(';')[0].trim().toLowerCase();
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/mp4') return 'm4a';
  return 'webm';
}
