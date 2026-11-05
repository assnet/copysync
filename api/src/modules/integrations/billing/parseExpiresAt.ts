/** ISO válido vira Date; nulo ou inválido vira `null` (sem vencimento conhecido). */
export function parseExpiresAt(raw: unknown): Date | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
