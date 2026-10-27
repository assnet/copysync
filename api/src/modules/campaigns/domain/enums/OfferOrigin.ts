/** Quem criou a oferta. Espelha o enum Prisma, sem importá-lo. */
export const OFFER_ORIGINS = ['GENERATOR', 'MONITORING'] as const;

export type OfferOrigin = (typeof OFFER_ORIGINS)[number];
