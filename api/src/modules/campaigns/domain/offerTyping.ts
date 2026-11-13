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

/** Envio em SEND_TIMEOUT pode ainda estar saindo: segura a faixa (e o reenvio do caçador) ao menos isso — timeout (60 s) + digitação (até 30 s), com folga. */
export const LANE_TIMEOUT_HOLD_SECONDS = 120;
