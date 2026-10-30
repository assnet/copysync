import type { StoryNode } from './storyPrimitives';
import { formatStoryCents } from './storyPrimitives';

/** Foto já normalizada (data URI) no tamanho natural (≤ `STORY_IMAGE_MAX`); o layout encaixa. */
export interface StoryImage {
  src: string;
  width: number;
  height: number;
}

/** Dados já formatados que todo layout recebe (o renderer prepara imagem e preço). */
export interface StoryLayoutModel {
  width: number;
  height: number;
  title: string;
  image: StoryImage | null;
  fromLabel: string | null;
  toLabel: string | null;
  /** % de desconto De→Por (1–99), só quando `fromLabel` existe; selo "-72%" na arte. */
  offPercent: number | null;
  coupon: { code: string; discountLabel: string | null } | null;
}

export type StoryLayoutBuilder = (model: StoryLayoutModel) => StoryNode;

/** Lado máximo da foto normalizada pelo renderer (nitidez no sticker de ~860px). */
export const STORY_IMAGE_MAX = 900;

export interface StoryModelInput {
  width: number;
  height: number;
  title: string;
  image: StoryImage | null;
  fromCents: number | null;
  toCents: number | null;
  coupon: { code: string; discountPercent: number | null } | null;
}

/** Deriva rótulos e o % do selo. "De" só aparece se maior que "Por"; % fica entre 1 e 99. */
export function buildStoryLayoutModel(input: StoryModelInput): StoryLayoutModel {
  const { fromCents, toCents } = input;
  const hasFrom = toCents !== null && fromCents !== null && fromCents > toCents;
  const off = hasFrom ? Math.round(((fromCents - toCents) / fromCents) * 100) : 0;
  return {
    width: input.width,
    height: input.height,
    title: input.title.trim(),
    image: input.image,
    toLabel: toCents !== null ? formatStoryCents(toCents) : null,
    fromLabel: hasFrom ? formatStoryCents(fromCents) : null,
    offPercent: hasFrom ? Math.min(99, Math.max(1, off)) : null,
    coupon: input.coupon
      ? {
          code: input.coupon.code,
          discountLabel: input.coupon.discountPercent !== null ? `-${input.coupon.discountPercent}%` : null,
        }
      : null,
  };
}
