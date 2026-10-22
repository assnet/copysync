import type { AffiliateProvider } from '../../domain/enums/AffiliateProvider';

/** AAD amarra o blob a tenant, provider e coluna: copiado para outro lugar, não decifra. */
export function affiliateCipherAad(
  tenantId: string,
  provider: AffiliateProvider,
  field: 'secret' | 'session',
): string {
  return `${tenantId}:${provider}:${field}`;
}
