/** Busca da vitrine: sem acento, sem caixa, todos os termos precisam aparecer. */
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function matchesQuery(haystack: string, query: string): boolean {
  const terms = normalizeText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = normalizeText(haystack);
  return terms.every((term) => text.includes(term));
}
