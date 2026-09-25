const MAX_FILE_NAME_LENGTH = 200;
const FALLBACK_FILE_NAME = 'arquivo';

/** Controle ASCII (`\x00-\x1f`, `\x7f`) e bidi (U+202A–202E, U+2066–2069), que disfarçam a extensão. */
const INVISIBLE_CHARS = /[\x00-\x1f\x7f‪-‮⁦-⁩]/g;
const PATH_SEPARATORS = /[/\\]/;

/** Corta em `max` caracteres (code points, sem partir emoji), preservando a extensão. */
function truncateKeepingExtension(name: string, max: number): string {
  const chars = Array.from(name);
  if (chars.length <= max) return name;

  const dot = chars.lastIndexOf('.');
  const extension = dot > 0 ? chars.slice(dot) : [];
  // Extensão que sozinha não cabe não é extensão de verdade: corta reto.
  if (extension.length === 0 || extension.length >= max) return chars.slice(0, max).join('');

  const base = chars.slice(0, max - extension.length).join('').trimEnd();
  return base + extension.join('');
}

/**
 * Nome de arquivo seguro para exibir e mandar ao WhatsApp. Nunca é usado como caminho no disco.
 *
 * Tira diretórios (`/`, `\`), caracteres de controle e bidi, pontos iniciais (`.`, `..`);
 * colapsa espaços; corta em 200 caracteres mantendo a extensão. Sem nome → `arquivo`.
 */
export function sanitizeFileName(name: string | null | undefined): string {
  const visible = (name ?? '').replace(INVISIBLE_CHARS, '');
  const baseName = visible.split(PATH_SEPARATORS).pop() ?? '';
  const cleaned = baseName.replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim();
  return cleaned ? truncateKeepingExtension(cleaned, MAX_FILE_NAME_LENGTH) : FALLBACK_FILE_NAME;
}
