/**
 * Política da rota estática de mídia (`GET <prefixo>/storage/...`).
 *
 * Funções puras usadas no registro do `@fastify/static` em `app/app.ts`.
 */
import path from 'path';

const MEDIA_PREFIX = '/media/';

// Só abre inline o que o navegador exibe sem rodar script. É o mesmo que já
// abria inline antes (imagem, áudio, vídeo, PDF); svg/html/xml e o resto baixam.
const INLINE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif',
  // `3gpp` é o que o download da mídia recebida gera para video/3gpp (`mimeTypeToExt`).
  'mp4', '3gp', '3gpp',
  'ogg', 'opus', 'mp3', 'm4a', 'aac',
  'pdf',
]);

/**
 * Só libera arquivo dentro de `media/`. Normaliza antes de checar porque o `send`
 * resolve `..` depois (sem isso `/media/../x` passaria), e nega segmento oculto
 * (`.uploads`, `.oculto`) mesmo dentro de `media/`.
 */
export function isAllowedMediaPath(pathName: string): boolean {
  const normalized = path.posix.normalize(pathName);
  if (!normalized.startsWith(MEDIA_PREFIX)) return false;
  return !normalized.split('/').some((segment) => segment.startsWith('.'));
}

/** `inline` só para a allowlist; qualquer outra extensão (ou nenhuma) vira download. */
export function contentDispositionFor(ext: string): 'inline' | 'attachment' {
  const normalized = ext.replace(/^\./, '').toLowerCase();
  return INLINE_EXTENSIONS.has(normalized) ? 'inline' : 'attachment';
}
