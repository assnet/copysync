import type { AffiliateProvider } from '@/types/api.types';
import { affiliateLinkStrings as t, isAffiliateProvider } from './strings';

/**
 * Fonte comum de texto e ação dos erros de link de afiliado. Cada feature (gerador, vitrine,
 * story) mantém o próprio adaptador e formato; aqui só se decide o texto e se há botão para
 * as credenciais. Códigos de plano, config, sessões e template ficam nas features.
 */
export type AffiliateLinkErrorAction = 'credentials' | 'none';

export interface AffiliateLinkErrorView {
  message: string;
  action: AffiliateLinkErrorAction;
}

export const AFFILIATE_LINK_ERROR_CODES = [
  'AFFILIATE_CREDENTIAL_REQUIRED',
  'AFFILIATE_CREDENTIAL_REJECTED',
  'AFFILIATE_API_ACCESS_DENIED',
  'AFFILIATE_API_RATE_LIMITED',
  'AFFILIATE_API_UNAVAILABLE',
  'OFFER_LINK_REBUILD_FAILED',
  'MARKETPLACE_RISK_NOT_ACCEPTED',
] as const;

export type AffiliateLinkErrorCode = (typeof AFFILIATE_LINK_ERROR_CODES)[number];

export function isAffiliateLinkErrorCode(code: unknown): code is AffiliateLinkErrorCode {
  return typeof code === 'string' && (AFFILIATE_LINK_ERROR_CODES as readonly string[]).includes(code);
}

/** `meta.provider` do erro, se for uma loja conhecida. */
export function providerFromMeta(meta: unknown): AffiliateProvider | null {
  const value = (meta as { provider?: unknown } | null | undefined)?.provider;
  return isAffiliateProvider(value) ? value : null;
}

/** `null` = código que não é deste módulo (a feature segue com o próprio mapa). */
export function describeAffiliateLinkError(code: string | null | undefined, meta?: unknown): AffiliateLinkErrorView | null {
  if (!isAffiliateLinkErrorCode(code)) return null;
  const p = providerFromMeta(meta);
  switch (code) {
    case 'AFFILIATE_CREDENTIAL_REQUIRED':
      return { message: t.errors.credentialRequired(p), action: 'credentials' };
    case 'AFFILIATE_CREDENTIAL_REJECTED':
      return { message: t.errors.credentialRejected(p), action: 'credentials' };
    case 'AFFILIATE_API_ACCESS_DENIED':
      return { message: t.errors.apiAccessDenied, action: 'none' };
    case 'AFFILIATE_API_RATE_LIMITED':
    case 'AFFILIATE_API_UNAVAILABLE':
      return { message: t.errors.storeUnavailable(p), action: 'none' };
    case 'OFFER_LINK_REBUILD_FAILED':
      return { message: t.errors.rebuildFailed(p), action: 'none' };
    case 'MARKETPLACE_RISK_NOT_ACCEPTED':
      return { message: t.errors.riskNotAccepted, action: 'credentials' };
  }
}

/** Rótulo do botão que leva às credenciais, conforme o erro. */
export function connectActionLabel(code: string | null | undefined, meta?: unknown): string {
  if (code === 'AFFILIATE_CREDENTIAL_REJECTED') return t.actions.review;
  if (code === 'MARKETPLACE_RISK_NOT_ACCEPTED') return t.actions.openCredentials;
  return t.actions.connect(providerFromMeta(meta));
}
