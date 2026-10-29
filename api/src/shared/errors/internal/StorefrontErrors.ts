import { AppError } from '../AppError';

// ── Página de Ofertas (.specs/features/storefront/design.md §5) ──────────────
//
// Slug inválido/reservado/tomado reusa `LinkRotationErrors.ts` (namespace compartilhado).
// `meta` vai ao cliente: nunca levar dado de outro tenant.

/** Nome especial (`LinkDomain.premiumNames`) sem concessão para o tenant. */
export class StorefrontSlugPremiumError extends AppError {
  constructor(slug: string) {
    super('STOREFRONT_SLUG_PREMIUM', 'Page name requires a premium grant', 409, { slug });
  }
}

/** Total de ofertas da página no limite (apague antes de extrair outra). */
export class StorefrontOfferLimitError extends AppError {
  constructor(limit: number) {
    super('STOREFRONT_OFFER_LIMIT', 'Storefront offer limit reached', 409, { limit });
  }
}

/** Publicadas no limite. */
export class StorefrontPublishedLimitError extends AppError {
  constructor(limit: number) {
    super('STOREFRONT_PUBLISHED_LIMIT', 'Storefront published offer limit reached', 409, { limit });
  }
}

/** Página ou oferta não existe para o tenant. */
export class StorefrontNotFoundError extends AppError {
  constructor(id?: string) {
    super('STOREFRONT_NOT_FOUND', 'Storefront not found', 404, id ? { id } : undefined);
  }
}

/** Reorder com ids faltando, repetidos ou fora da aba. */
export class StorefrontOrderInvalidError extends AppError {
  constructor() {
    super('STOREFRONT_ORDER_INVALID', 'Offer order must list exactly the offers of the tab', 400);
  }
}
