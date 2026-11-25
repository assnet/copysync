/** Marketplaces com programa de afiliados suportados. Espelha o enum Prisma, sem importá-lo. */
export const AFFILIATE_PROVIDERS = [
  'SHOPEE',
  'MERCADO_LIVRE', 'AMAZON',
  'SHEIN',
  'KABUM',
  'MAGALU',
  'ALIEXPRESS',
] as const;

export type AffiliateProvider = (typeof AFFILIATE_PROVIDERS)[number];
