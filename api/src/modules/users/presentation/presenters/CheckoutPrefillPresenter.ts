import type { CheckoutPrefill } from '../../domain/services/checkoutPrefill';

/** Resposta de `GET /me/checkout-prefill`: só as chaves preenchidas, nada além delas. */
export class CheckoutPrefillPresenter {
  static toResponse(prefill: CheckoutPrefill): CheckoutPrefill {
    const out: CheckoutPrefill = {};
    if (prefill.email) out.email = prefill.email;
    if (prefill.confirmEmail) out.confirmEmail = prefill.confirmEmail;
    if (prefill.name) out.name = prefill.name;
    return out;
  }
}
