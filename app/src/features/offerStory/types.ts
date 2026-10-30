import type { AffiliateProvider } from '@/types/api.types';

/** Contrato de `api/src/modules/offer-story/presentation/` (envelope `{ data }`). */
export interface OfferStoryTemplate {
  id: string;
  name: string;
}

export type OfferStoryWarning = 'NO_IMAGE' | 'NO_PRICE' | 'AI_FALLBACK';

export interface OfferStoryCouponInput {
  code: string;
  discountPercent?: number;
}

export interface RenderOfferStoryInput {
  templateId: string;
  url: string;
  coupon?: OfferStoryCouponInput;
}

export interface OfferStoryResult {
  /** `data:image/jpeg;base64,…` (1080×1920). Só em memória: nunca persistir. */
  image: string;
  width: number;
  height: number;
  templateId: string;
  headline: string;
  provider: AffiliateProvider;
  affiliateUrl: string;
  attributionVerified: boolean;
  price: { fromCents: number | null; toCents: number | null };
  coupon: { code: string; discountPercent: number | null } | null;
  warnings: OfferStoryWarning[];
}

/** Erro rejeitado pelo `apiClient` (interceptor expõe `code`, `field`, `meta`). */
export interface OfferStoryApiError {
  status?: number;
  code?: string;
  field?: string;
  meta?: Record<string, unknown> | null;
}

/** Thumbnail estático (360×640) gerado pelo renderer da API. */
export const templateThumbnail = (id: string) => `/assets/offer-story/${encodeURIComponent(id)}.webp`;
