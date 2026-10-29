/**
 * Lógica pura das ofertas no painel: preço em reais ↔ centavos, categorias da página e validação
 * leve do "Editar oferta". A API revalida tudo; aqui só evita ida e volta óbvia.
 */
import type { StorefrontCategory, StorefrontOffer, UpdateStorefrontOfferInput } from './types';
import { STOREFRONT_RANGES } from './types';

const THOUSANDS_ONLY = /^\d{1,3}(\.\d{3})+$/;
const DECIMAL = /^\d+(\.\d{1,2})?$/;

/**
 * "R$ 1.234,56" → 123456. Vazio → null (sem preço). Inválido → undefined.
 * Vírgula é o decimal; ponto sozinho é decimal, salvo no formato de milhar ("1.234").
 */
export function parseReaisToCents(raw: string): number | null | undefined {
  const s = raw.replace(/R\$/gi, '').replace(/\s/g, '');
  if (!s) return null;
  let n: string;
  if (s.includes(',')) n = s.replace(/\./g, '').replace(',', '.');
  else if (THOUSANDS_ONLY.test(s)) n = s.replace(/\./g, '');
  else n = s;
  if (!DECIMAL.test(n)) return undefined;
  const cents = Math.round(Number(n) * 100);
  return Number.isSafeInteger(cents) ? cents : undefined;
}

/** 123456 → "1234,56" (valor do campo de edição); null → "". */
export const centsToReaisInput = (cents: number | null): string =>
  cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatCents = (cents: number): string => BRL.format(cents / 100);

/** Opções de categoria de uma oferta: só as selecionadas na página, na ordem do catálogo. */
export const pageCategoryOptions = (catalog: readonly StorefrontCategory[], selected: readonly string[]): StorefrontCategory[] =>
  catalog.filter((c) => selected.includes(c.key));

export const categoryLabel = (catalog: readonly StorefrontCategory[], key: string | null): string | null =>
  key === null ? null : (catalog.find((c) => c.key === key)?.label ?? key);

export interface EditOfferForm {
  title: string;
  price: string;
  originalPrice: string;
  category: string | null;
}

export type EditOfferErrors = Partial<Record<'title' | 'price' | 'originalPrice', true>>;

export const editFormFromOffer = (o: StorefrontOffer): EditOfferForm => ({
  title: o.title,
  price: centsToReaisInput(o.priceCents),
  originalPrice: centsToReaisInput(o.originalPriceCents),
  category: o.category,
});

export function validateEditOffer(form: EditOfferForm): EditOfferErrors {
  const errors: EditOfferErrors = {};
  const title = form.title.trim();
  if (title.length < 1 || title.length > STOREFRONT_RANGES.offerTitleMax) errors.title = true;
  if (parseReaisToCents(form.price) === undefined) errors.price = true;
  if (parseReaisToCents(form.originalPrice) === undefined) errors.originalPrice = true;
  return errors;
}

/** Só os campos que mudaram (o PATCH exige ao menos um); `null` = nada mudou. Assume form válido. */
export function editOfferPatch(offer: StorefrontOffer, form: EditOfferForm): UpdateStorefrontOfferInput | null {
  const patch: UpdateStorefrontOfferInput = {};
  const title = form.title.trim();
  const price = parseReaisToCents(form.price) ?? null;
  const originalPrice = parseReaisToCents(form.originalPrice) ?? null;
  if (title !== offer.title) patch.title = title;
  if (price !== offer.priceCents) patch.priceCents = price;
  if (originalPrice !== offer.originalPriceCents) patch.originalPriceCents = originalPrice;
  if (form.category !== offer.category) patch.category = form.category;
  return Object.keys(patch).length ? patch : null;
}
