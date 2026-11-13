import type { AffiliateProvider } from '../enums/AffiliateProvider';
import type { MarketplaceRiskScope } from '../enums/MarketplaceRiskScope';
import { DEFAULT_MARKETPLACE_RISK_SCOPE } from '../enums/MarketplaceRiskScope';

/**
 * Versão vigente do aviso de risco do marketplace (escopo `AFFILIATE_LINK`). Só quem está aqui exige aceite.
 * O texto do aviso vive só no painel (`features/settings/strings.ts`), que espelha a versão:
 * mudou o texto, sobe a versão nos dois lados; versão divergente vira 409 no aceite.
 */
export const MARKETPLACE_RISK_NOTICE_VERSION: Partial<Record<AffiliateProvider, string>> = {
  SHEIN: '2026-11-10',
};

/**
 * Versão vigente do aviso do caçador de ofertas (escopo `OFFER_HUNTER`), uma por marca, aceite separado
 * (decisão D2, 2026-11-13). Aviso autônomo, cobrado sozinho em todo o fluxo do caçador. Mesma regra de
 * espelho com o painel (`features/offerHunter/strings.ts`). Fail-closed: marca fora daqui não caça.
 */
export const OFFER_HUNTER_RISK_NOTICE_VERSION: Partial<Record<AffiliateProvider, string>> = {
  SHEIN: '2026-11-12',
  MERCADO_LIVRE: '2026-11-13',
};

/** Escopos em que marca sem aviso fica bloqueada (sem versão = impossível aceitar = nunca liberado). */
const FAIL_CLOSED_SCOPES: ReadonlySet<MarketplaceRiskScope> = new Set(['OFFER_HUNTER']);

export function isRiskScopeFailClosed(scope: MarketplaceRiskScope): boolean {
  return FAIL_CLOSED_SCOPES.has(scope);
}

const NOTICE_VERSION_BY_SCOPE: Record<MarketplaceRiskScope, Partial<Record<AffiliateProvider, string>>> = {
  AFFILIATE_LINK: MARKETPLACE_RISK_NOTICE_VERSION,
  OFFER_HUNTER: OFFER_HUNTER_RISK_NOTICE_VERSION,
};

/** null = o provider não tem aviso nesse escopo (no `AFFILIATE_LINK`: não exige aceite; no `OFFER_HUNTER`: bloqueado). */
export function currentRiskNoticeVersion(
  provider: AffiliateProvider,
  scope: MarketplaceRiskScope = DEFAULT_MARKETPLACE_RISK_SCOPE,
): string | null {
  return NOTICE_VERSION_BY_SCOPE[scope][provider] ?? null;
}

/** Escopo fail-closed (`OFFER_HUNTER`) sempre exige: sem versão, o gate responde "não aceito". */
export function requiresRiskAcceptance(
  provider: AffiliateProvider,
  scope: MarketplaceRiskScope = DEFAULT_MARKETPLACE_RISK_SCOPE,
): boolean {
  return isRiskScopeFailClosed(scope) || currentRiskNoticeVersion(provider, scope) !== null;
}
