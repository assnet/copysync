/**
 * Contrato HTTP da Página de Ofertas (`/storefront`). Espelha os schemas de
 * `api/src/modules/storefront/presentation/schemas/storefront.schema.ts` — eles mandam.
 */

export type StorefrontStatus = 'ACTIVE' | 'PAUSED_BY_PLAN';
export type StorefrontOfferStatus = 'DRAFT' | 'PUBLISHED';
export type StorefrontOfferProvider = 'SHOPEE' | 'MERCADO_LIVRE' | 'AMAZON';
export type StorefrontImageKind = 'avatar' | 'cover';
export type StorefrontViewport = 'mobile' | 'desktop';

/** Limites das regras da API (`storefrontRules.ts`, `slugRules.ts`); a API revalida. */
export const STOREFRONT_RANGES = {
  name: { min: 2, max: 60 },
  subtitleMax: 80,
  offerTitleMax: 140,
  slug: { min: 3, max: 50 },
  maxOffers: 200,
  maxPublished: 60,
} as const;

export interface Storefront {
  id: string;
  title: string;
  subtitle: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  colorPrimary: string;
  colorBackground: string;
  colorCard: string;
  categories: string[];
  status: StorefrontStatus;
  /** null = endereço ausente (janela inconsistente); a página não é servida. */
  domainId: string | null;
  slug: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StorefrontOffer {
  id: string;
  status: StorefrontOfferStatus;
  position: number;
  provider: StorefrontOfferProvider;
  sourceUrl: string;
  affiliateUrl: string;
  /** false = selo "comissão não verificada". */
  attributionVerified: boolean;
  title: string;
  priceCents: number | null;
  originalPriceCents: number | null;
  imageUrl: string | null;
  category: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StorefrontCategory {
  key: string;
  label: string;
}

export interface StorefrontDomain {
  id: string;
  hostname: string;
}

/** `GET /storefront`. `storefront` null = página ainda não criada. */
export interface StorefrontOverview {
  storefront: Storefront | null;
  publicUrl: string | null;
  offers: { drafts: StorefrontOffer[]; published: StorefrontOffer[] };
  categories: StorefrontCategory[];
  subtitleSuggestions: string[];
  domains: StorefrontDomain[];
}

export type SlugAvailabilityStatus = 'INVALID' | 'RESERVED' | 'PREMIUM' | 'TAKEN' | 'OWNED' | 'AVAILABLE';

/** `GET /storefront/slug-availability`. */
export interface SlugAvailability {
  status: SlugAvailabilityStatus;
  /** Nome já normalizado pela API. */
  slug: string;
  reservedReason?: 'NAME' | 'RECENT_RELEASE';
  suggestions: string[];
}

/** `PUT /storefront`. */
export interface SaveStorefrontInput {
  domainId: string;
  slug: string;
  title: string;
  subtitle: string | null;
  colorPrimary: string;
  colorBackground: string;
  colorCard: string;
  categories: string[];
}

/** `POST /storefront/preview`: a prévia nunca recusa por regra, só por teto. */
export interface StorefrontPreviewDraft {
  title: string;
  subtitle: string | null;
  colorPrimary: string;
  colorBackground: string;
  colorCard: string;
  categories: string[];
  slug?: string;
  domainId?: string;
}

/** `PATCH /storefront/offers/:id` (ao menos um campo). */
export interface UpdateStorefrontOfferInput {
  title?: string;
  priceCents?: number | null;
  originalPriceCents?: number | null;
  category?: string | null;
}

/** Erro rejeitado pelo `apiClient` (`status`, `code`, `field`, `meta`). */
export interface StorefrontApiError {
  status?: number;
  code?: string;
  field?: string;
  meta?: Record<string, unknown> | null;
}
