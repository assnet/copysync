/** Dados que alimentam o texto da oferta. Preços em centavos (BRL). */
export interface OfferTextInput {
  title?: string | null;
  priceCents?: number | null;
  originalPriceCents?: number | null;
  affiliateUrl: string;
  coupon?: string | null;
}

/** Modelo padrão, estilo WhatsApp (`~riscado~`). Linhas sem dado somem. */
export const DEFAULT_OFFER_TEMPLATE = [
  '🔥 {titulo}',
  '',
  '~De {preco_original}~',
  '✅ Por {preco}',
  '📉 {desconto} OFF',
  '🎟️ Cupom: {cupom}',
  '',
  '🛒 {link}',
].join('\n');

const PLACEHOLDER = /\{(titulo|preco|preco_original|desconto|cupom|link)\}/g;

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** `R$ 1.234,56` — o Intl usa NBSP após o símbolo; vira espaço comum. */
export function formatPrice(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '';
  return BRL.format(cents / 100).replace(/\s/g, ' ');
}

/**
 * Preenche o modelo com os dados do produto.
 *
 * Linha cujos marcadores ficaram todos vazios é removida — sem preço original não
 * sobra `~De ~`. Preço original e desconto só aparecem quando o original é maior que
 * o preço: "de R$ 10 por R$ 10" não é oferta. Linhas em branco repetidas viram uma.
 */
export function renderOfferText(input: OfferTextInput, template: string = DEFAULT_OFFER_TEMPLATE): string {
  const price = input.priceCents ?? null;
  const original = input.originalPriceCents ?? null;
  const hasDiscount = price != null && original != null && price > 0 && original > price;
  const discount = hasDiscount ? Math.round((1 - price / original) * 100) : 0;

  const values: Record<string, string> = {
    titulo: input.title?.trim() ?? '',
    preco: formatPrice(price),
    preco_original: hasDiscount ? formatPrice(original) : '',
    desconto: discount > 0 ? `${discount}%` : '',
    cupom: input.coupon?.trim() ?? '',
    link: input.affiliateUrl.trim(),
  };

  const lines: string[] = [];
  for (const line of template.split(/\r?\n/)) {
    const keys = [...line.matchAll(PLACEHOLDER)].map((m) => m[1]);
    if (keys.length > 0 && keys.every((k) => values[k] === '')) continue;
    const rendered = line.replace(PLACEHOLDER, (_, k: string) => values[k]).trimEnd();
    if (rendered === '' && lines[lines.length - 1] === '') continue;
    lines.push(rendered);
  }
  return lines.join('\n').trim();
}
