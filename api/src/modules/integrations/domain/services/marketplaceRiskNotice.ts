import type { AffiliateProvider } from '../enums/AffiliateProvider';

/**
 * Versão vigente do aviso de risco por marketplace. Só quem está aqui exige aceite.
 * O texto do aviso vive só no painel (`features/settings/strings.ts`), que espelha a versão:
 * mudou o texto, sobe a versão nos dois lados; versão divergente vira 409 no aceite.
 */
export const MARKETPLACE_RISK_NOTICE_VERSION: Partial<Record<AffiliateProvider, string>> = {
  SHEIN: '2026-11-10',
};

export function currentRiskNoticeVersion(provider: AffiliateProvider): string | null {
  return MARKETPLACE_RISK_NOTICE_VERSION[provider] ?? null;
}

export function requiresRiskAcceptance(provider: AffiliateProvider): boolean {
  return currentRiskNoticeVersion(provider) !== null;
}
