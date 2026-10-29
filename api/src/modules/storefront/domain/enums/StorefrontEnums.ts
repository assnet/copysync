/** Espelho TS dos enums Prisma da Página de Ofertas (design.md §3). Valores idênticos aos do banco. */

export enum StorefrontStatus {
  ACTIVE = 'ACTIVE',
  /** Plano sem `storefront_enabled`: página sai do ar ("pausada"), nome mantido (decisão 11). */
  PAUSED_BY_PLAN = 'PAUSED_BY_PLAN',
}

export enum StorefrontOfferStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}
