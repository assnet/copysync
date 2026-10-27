/** Ciclo de vida de uma oferta gerada. Espelha o enum Prisma, sem importá-lo. */
export const OFFER_STATUSES = ['DRAFT', 'SENDING', 'PAUSED', 'SENT', 'FAILED', 'CANCELLED'] as const;

export type OfferStatus = (typeof OFFER_STATUSES)[number];
