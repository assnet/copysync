export const CHAT_LIST_NAME_MAX_LENGTH = 40;

/**
 * Nome de lista como o catálogo grava: aparado, 1..40 caracteres. `null` = inválido.
 * Mesma regra do painel (`validateListName`); fonte única no servidor.
 */
export function normalizeChatListName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0 || name.length > CHAT_LIST_NAME_MAX_LENGTH) return null;
  return name;
}

/** Comparação de nomes de lista: sem diferenciar maiúsculas (mesma regra do `mode: insensitive`). */
export function sameChatListName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
