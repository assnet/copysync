/** Formato da foto no envio: `MEDIA` = imagem com legenda; `LINK_PREVIEW` = texto com prévia do link. */
export const OFFER_IMAGE_MODES = ['MEDIA', 'LINK_PREVIEW'] as const;

export type OfferImageMode = (typeof OFFER_IMAGE_MODES)[number];

/**
 * `MEDIA` desligado para todos os planos até nova decisão: oferta salva com `MEDIA` sai como
 * `LINK_PREVIEW` no envio. Para religar, `true` aqui e em `app/src/features/offers/utils/offerConfig.ts`.
 */
export const MEDIA_IMAGE_MODE_ENABLED = false;

/** Formato padrão de oferta nova (espelha o `@default` do Prisma). */
export const DEFAULT_OFFER_IMAGE_MODE: OfferImageMode = 'LINK_PREVIEW';

/** Formato que vale no envio/gravação, respeitando o desligamento de `MEDIA`. */
export function effectiveImageMode(mode: OfferImageMode): OfferImageMode {
  return mode === 'MEDIA' && !MEDIA_IMAGE_MODE_ENABLED ? 'LINK_PREVIEW' : mode;
}
