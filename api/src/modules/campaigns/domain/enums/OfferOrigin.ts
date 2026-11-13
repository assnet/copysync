/** Quem criou a oferta. Espelha o enum Prisma, sem importá-lo. */
export const OFFER_ORIGINS = ['GENERATOR', 'MONITORING', 'HUNTER'] as const;

export type OfferOrigin = (typeof OFFER_ORIGINS)[number];

/**
 * Manuais/curadas: no claim furam a fila do monitoramento da sessão (docs/fila-de-envio.md §2.4),
 * então na previsão da faixa só esperam umas pelas outras.
 */
export const MANUAL_OFFER_ORIGINS: readonly OfferOrigin[] = ['GENERATOR', 'HUNTER'];
