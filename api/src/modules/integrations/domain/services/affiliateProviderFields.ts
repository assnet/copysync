import type { AffiliateProvider } from '../enums/AffiliateProvider';

/**
 * Campos de cada programa de afiliados (verificado em T0, 2026-10-22). Nenhum dos três publica
 * formato oficial: as regras são permissivas de propósito, para não recusar valor real.
 *
 * - Shopee Affiliate Open API: "AppID" (numérico) + "Secret" (assina `sha256(appId+ts+payload+secret)`)
 * - Mercado Livre: etiqueta do afiliado (`matt_word` no link); sem segredo — a sessão vem da extensão
 * - Amazon Associados: "ID de rastreamento" (`?tag=`, ex. `minhaloja-20`); sem segredo
 */
export interface AffiliateProviderFields {
  publicIdentifier: { pattern: RegExp; maxLength: number };
  secret: { pattern: RegExp; maxLength: number } | null;
}

export const AFFILIATE_PROVIDER_FIELDS: Record<AffiliateProvider, AffiliateProviderFields> = {
  SHOPEE: {
    publicIdentifier: { pattern: /^\d{5,20}$/, maxLength: 20 },
    secret: { pattern: /^[A-Za-z0-9]{16,128}$/, maxLength: 128 },
  },
  MERCADO_LIVRE: {
    publicIdentifier: { pattern: /^[A-Za-z0-9._-]{2,64}$/, maxLength: 64 },
    secret: null,
  },
  AMAZON: {
    publicIdentifier: { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}-\d{2}$/, maxLength: 67 },
    secret: null,
  },
};

export function providerRequiresSecret(provider: AffiliateProvider): boolean {
  return AFFILIATE_PROVIDER_FIELDS[provider].secret !== null;
}

/** Valor já com `trim`, ou null se vazio/fora do formato. */
export function validatePublicIdentifier(provider: AffiliateProvider, value: string): string | null {
  const v = value.trim();
  const rule = AFFILIATE_PROVIDER_FIELDS[provider].publicIdentifier;
  return v.length <= rule.maxLength && rule.pattern.test(v) ? v : null;
}

/** Valor já com `trim`, ou null se vazio, fora do formato ou se o provider não tem segredo. */
export function validateSecret(provider: AffiliateProvider, value: string): string | null {
  const rule = AFFILIATE_PROVIDER_FIELDS[provider].secret;
  if (!rule) return null;
  const v = value.trim();
  return v.length <= rule.maxLength && rule.pattern.test(v) ? v : null;
}
