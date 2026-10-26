import { OfferInvalidInputError } from '../../../../shared/errors/internal/OfferErrors';

export const OFFER_COUPON_MAX = 40;
/** Letras, dígitos, `-`, `_`, `.` e espaço — o cupom vai para o texto e para o prompt da IA. */
const COUPON_PATTERN = /^[\p{L}\p{N}_.\- ]+$/u;

/** Normaliza o cupom: vazio → null; formato inválido → OFFER_INVALID_INPUT (`coupon`). */
export function normalizeCoupon(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (!value) return null;
  if (value.length > OFFER_COUPON_MAX) {
    throw new OfferInvalidInputError(`Coupon exceeds ${OFFER_COUPON_MAX} characters`, 'coupon');
  }
  if (!COUPON_PATTERN.test(value)) throw new OfferInvalidInputError('Coupon has invalid characters', 'coupon');
  return value;
}
