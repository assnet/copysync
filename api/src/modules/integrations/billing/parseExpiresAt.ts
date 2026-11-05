/**
 * Vencimento vindo do hub. `null` explícito = sem vencimento; string ISO válida = data.
 * Qualquer outra coisa (string ruim, `""`, número, objeto) é malformada: quem chama recusa
 * ou ignora, nunca grava `null` (= tenant sem vencimento).
 */
export type ParsedExpiresAt = { valid: true; value: Date | null } | { valid: false };

export function parseExpiresAt(raw: unknown): ParsedExpiresAt {
  if (raw === null) return { valid: true, value: null };
  if (typeof raw !== 'string' || raw.trim() === '') return { valid: false };
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? { valid: false } : { valid: true, value: date };
}
