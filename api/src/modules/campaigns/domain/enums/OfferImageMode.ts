/** Formato da foto no envio: `MEDIA` = imagem com legenda; `LINK_PREVIEW` = texto com prévia do link. */
export const OFFER_IMAGE_MODES = ['MEDIA', 'LINK_PREVIEW'] as const;

export type OfferImageMode = (typeof OFFER_IMAGE_MODES)[number];
