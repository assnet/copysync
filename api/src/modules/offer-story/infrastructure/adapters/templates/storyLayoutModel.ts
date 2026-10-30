import type { StoryNode } from './storyPrimitives';

/** Dados já formatados que todo layout recebe (o renderer prepara imagem e preço). */
export interface StoryLayoutModel {
  width: number;
  height: number;
  title: string;
  /** Foto normalizada (data URI) já com o tamanho de exibição dentro da caixa do card. */
  image: { src: string; width: number; height: number } | null;
  fromLabel: string | null;
  toLabel: string | null;
  coupon: { code: string; discountLabel: string | null } | null;
}

export type StoryLayoutBuilder = (model: StoryLayoutModel) => StoryNode;

/** Caixa da foto no card: o renderer encaixa a imagem (contain) dentro destes limites. */
export const STORY_IMAGE_BOX = { width: 792, height: 480 } as const;
