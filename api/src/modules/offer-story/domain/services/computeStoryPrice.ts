/** Preço exibido na arte, em centavos. `null` = não mostrar. Tabela em spec.md "Regras de preço". */
export interface StoryPrice {
  fromCents: number | null;
  toCents: number | null;
}

export function computeStoryPrice(
  product: { priceCents: number | null; originalPriceCents: number | null },
  discountPercent: number | null,
): StoryPrice {
  const { priceCents: price, originalPriceCents: original } = product;
  if (price === null || price <= 0) return { fromCents: null, toCents: null };
  const higherOriginal = original !== null && original > price ? original : null;
  if (discountPercent === null) return { fromCents: higherOriginal, toCents: price };
  const discounted = Math.round((price * (100 - discountPercent)) / 100);
  // Desconto que arredonda para R$ 0,00 não vira preço na arte (vira NO_PRICE).
  if (discounted <= 0) return { fromCents: null, toCents: null };
  return { fromCents: higherOriginal ?? price, toCents: discounted };
}
