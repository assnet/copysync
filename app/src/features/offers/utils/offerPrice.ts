const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos → "R$ 1.234,56". */
export function formatCents(cents: number): string {
  return brl.format(cents / 100);
}

/**
 * Máscara de moeda: só os dígitos contam, e os dois últimos são centavos ("12345" → 12345 = R$ 123,45).
 * Sem dígito → `null` (campo vazio). Teto de 9 dígitos para não passar de R$ 9.999.999,99.
 */
export function parseCentsInput(raw: string): number | null {
  const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 9);
  return digits ? Number(digits) : null;
}

/** Valor do campo mascarado; `null` mostra vazio. */
export function centsToInput(cents: number | null): string {
  return cents == null ? '' : formatCents(cents);
}

/** Desconto inteiro em % quando o preço original é maior que o atual; senão `null`. */
export function discountPercent(priceCents: number | null, originalPriceCents: number | null): number | null {
  if (priceCents == null || originalPriceCents == null || originalPriceCents <= priceCents || originalPriceCents <= 0) {
    return null;
  }
  const pct = Math.round((1 - priceCents / originalPriceCents) * 100);
  return pct > 0 ? pct : null;
}
