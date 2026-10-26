/** Público-alvo do texto da oferta. `STANDARD` = modelo fixo, sem IA. */
export const OFFER_AUDIENCES = ['STANDARD', 'MOMS', 'PET', 'BEAUTY_FASHION', 'MEN', 'FITNESS', 'HOME_KITCHEN'] as const;

export type OfferAudience = (typeof OFFER_AUDIENCES)[number];
