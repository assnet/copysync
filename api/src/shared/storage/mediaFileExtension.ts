/**
 * Extensão do arquivo de mídia no disco a partir do MIME type.
 *
 * Regra única do download da mídia recebida (adapter do Baileys) e da promoção da mídia
 * enviada (`LocalMediaFileStore`): os dois gravam `${sessionId}_${externalId}.${ext}`, e o eco
 * do próprio envio só é reconhecido no disco se o nome bater.
 *
 * A extensão certa também evita que o @fastify/static sirva o arquivo com Content-Type errado
 * (ex.: áudio como video/mpeg por `.mpeg`), que o navegador recusa no <audio>.
 *
 * Mudar uma saída existente muda o nome do arquivo novo recebido daquele tipo: só acrescente.
 */
const MIME_TO_EXT: Record<string, string> = {
  'audio/mpeg':   'mp3',
  'audio/mp3':    'mp3',
  'audio/mp4':    'm4a',
  'audio/x-m4a':  'm4a',
  'audio/aac':    'aac',
  'audio/ogg':    'ogg',
  'image/jpeg':   'jpg',
  'image/jpg':    'jpg',
  'video/mp4':    'mp4',
  'video/mpeg':   'mpeg',

  // Envio de mídia. Os que já saíam iguais pelo subtipo ficam explícitos como registro.
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
  // `3gpp`, não `3gp`: é o que o download já gerava (e o que `staticMediaPolicy` libera).
  'video/3gpp':      '3gpp',
  'video/quicktime': 'mov',
  'application/pdf':          'pdf',
  'application/zip':          'zip',
  'application/octet-stream': 'bin',
  'application/msword':            'doc',
  'application/vnd.ms-excel':      'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':   'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':         'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv':   'csv',
};

/** Fora do mapa vale o subtipo (`image/heic` → `heic`); sem MIME type ou sem subtipo, `bin`. */
export function mimeTypeToExt(mimeType: string | null | undefined): string {
  if (!mimeType) return 'bin';
  const normalized = mimeType.split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[normalized] ?? normalized.split('/')[1]?.split(';')[0] ?? 'bin';
}
