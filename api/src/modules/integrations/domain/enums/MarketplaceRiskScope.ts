/**
 * Escopo do aviso de risco. `AFFILIATE_LINK` = aviso do marketplace (link de afiliado, padrão);
 * `OFFER_HUNTER` = caçador de ofertas (busca, link e envio automáticos). Espelha o enum Prisma, sem importá-lo.
 */
export const MARKETPLACE_RISK_SCOPES = ['AFFILIATE_LINK', 'OFFER_HUNTER'] as const;

export type MarketplaceRiskScope = (typeof MARKETPLACE_RISK_SCOPES)[number];

export const DEFAULT_MARKETPLACE_RISK_SCOPE: MarketplaceRiskScope = 'AFFILIATE_LINK';
