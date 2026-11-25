import {
  OFFER_WATERMARK_MARGIN_RATIO,
  OFFER_WATERMARK_SIZE_RATIO,
  type OfferWatermarkPosition,
  type OfferWatermarkSize,
} from './offerWatermarkRules';

export interface Dimensions {
  width: number;
  height: number;
}

export interface WatermarkPlacement {
  width: number;
  height: number;
  left: number;
  top: number;
}

/**
 * Onde e de que tamanho a marca entra na foto (função pura, pixels inteiros).
 *
 * Largura = lado menor da foto × 15/22/30 % (SMALL/MEDIUM/LARGE); altura proporcional à marca;
 * margem de 4 % do lado menor até a borda. Marca muito alta (texto em pé, logo estreito) é reduzida
 * para caber na altura útil: o resultado fica sempre dentro da foto, com a margem.
 */
export function computeWatermarkPlacement(
  photo: Dimensions,
  mark: Dimensions,
  position: OfferWatermarkPosition,
  size: OfferWatermarkSize,
): WatermarkPlacement {
  const photoW = Math.max(1, Math.floor(photo.width));
  const photoH = Math.max(1, Math.floor(photo.height));
  const minSide = Math.min(photoW, photoH);
  const margin = Math.floor(minSide * OFFER_WATERMARK_MARGIN_RATIO);
  const aspect = mark.width > 0 && mark.height > 0 ? mark.height / mark.width : 1;

  const maxW = Math.max(1, photoW - 2 * margin);
  const maxH = Math.max(1, photoH - 2 * margin);
  let width = Math.min(maxW, Math.max(1, Math.round(minSide * OFFER_WATERMARK_SIZE_RATIO[size])));
  let height = Math.max(1, Math.round(width * aspect));
  if (height > maxH) {
    height = maxH;
    width = Math.min(maxW, Math.max(1, Math.round(height / aspect)));
  }

  const right = photoW - margin - width;
  const bottom = photoH - margin - height;
  const centerLeft = Math.floor((photoW - width) / 2);
  const centerTop = Math.floor((photoH - height) / 2);
  switch (position) {
    case 'TOP_LEFT':
      return { width, height, left: margin, top: margin };
    case 'TOP_RIGHT':
      return { width, height, left: right, top: margin };
    case 'BOTTOM_LEFT':
      return { width, height, left: margin, top: bottom };
    case 'BOTTOM_RIGHT':
      return { width, height, left: right, top: bottom };
    case 'CENTER':
      return { width, height, left: centerLeft, top: centerTop };
  }
}
