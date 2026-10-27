/** Estado do envio de uma oferta para um destino. Espelha o enum Prisma, sem importá-lo. */
export const OFFER_DISPATCH_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED'] as const;

export type OfferDispatchStatus = (typeof OFFER_DISPATCH_STATUSES)[number];
