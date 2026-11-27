import type { Dimensions } from '@/features/offerWatermark/rules';

/** Área (em % da caixa) que a foto ocupa com `object-fit: contain`, centralizada. */
export function containedPhotoRect(photo: Dimensions, boxRatio: number): { left: number; top: number; width: number; height: number } {
  const ratio = photo.width / Math.max(1, photo.height);
  if (ratio >= boxRatio) {
    const height = (boxRatio / ratio) * 100;
    return { left: 0, top: (100 - height) / 2, width: 100, height };
  }
  const width = (ratio / boxRatio) * 100;
  return { left: (100 - width) / 2, top: 0, width, height: 100 };
}
