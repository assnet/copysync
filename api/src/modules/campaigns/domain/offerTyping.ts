/**
 * "Digitando…" antes da oferta. Teto de 30 s: a digitação conta dentro do envio, e o worker
 * estende o timeout por ela — sem teto, um valor alto viraria SEND_TIMEOUT.
 */
export const OFFER_TYPING_SECONDS_DEFAULT = 15;
export const OFFER_TYPING_SECONDS_MIN = 1;
export const OFFER_TYPING_SECONDS_MAX = 30;

export function isValidTypingSeconds(value: number): boolean {
  return Number.isInteger(value) && value >= OFFER_TYPING_SECONDS_MIN && value <= OFFER_TYPING_SECONDS_MAX;
}
