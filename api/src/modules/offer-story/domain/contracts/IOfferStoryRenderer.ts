import type { OfferStoryTemplate } from '../offerStoryTemplates';
import type { StoryPrice } from '../services/computeStoryPrice';

export interface OfferStoryRenderInput {
  template: OfferStoryTemplate;
  /** Título final (IA ou original); o renderer corta em 3 linhas. */
  headline: string;
  /** Bytes crus da foto do produto (qualquer formato que o sharp abra) ou null = card sem foto. */
  productImage: Buffer | null;
  price: StoryPrice;
  coupon: { code: string; discountPercent: number | null } | null;
}

export interface RenderedOfferStory {
  buffer: Buffer;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  /** true quando `productImage` veio mas não abriu (renderizou sem foto). */
  imageDropped: boolean;
}

/**
 * Monta a arte do story. Nunca lança erro cru da lib: falha vira `MEDIA_PROCESSING_FAILED`.
 * Imagem do produto ilegível não falha a arte (`imageDropped`).
 */
export interface IOfferStoryRenderer {
  render(input: OfferStoryRenderInput): Promise<RenderedOfferStory>;
}
