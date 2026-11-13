// Adaptador do Caçador para o Mercado Livre (design §3b, registry por marca em `hunterContainer.ts`).
// Sessão = cookies da credencial ML (precisa de `ssid`, igual ao `TenantAffiliateLinkComposer`); link continua via
// Resolve com a etiqueta ativa da conta.
import type { OfferAffiliateCredential } from '../../../domain/contracts/IAffiliateCredentialResolver';
import type { IHuntProviderAdapter } from '../../../domain/contracts/hunter/IHuntProviderAdapter';
import type { HuntSourceSession, IHuntCatalogSource } from '../../../domain/hunter/HuntProvider';
import {
  MERCADO_LIVRE_HUNT_CAPABILITIES,
  MERCADO_LIVRE_PRODUCT_ID,
} from '../../../domain/services/hunter/mercadoLivreCapabilities';
import { MercadoLivreHubClient } from '../../http/MercadoLivreHubClient';

/** Cookies da credencial com `ssid` não vazio; senão null (sem credencial utilizável). Nunca loga. */
export function mercadoLivreSessionFrom(
  credential: Pick<OfferAffiliateCredential, 'session'> | null | undefined,
): HuntSourceSession | null {
  const cookies = credential?.session?.cookies;
  if (!cookies || typeof cookies.ssid !== 'string' || !cookies.ssid.trim()) return null;
  return { provider: 'MERCADO_LIVRE', cookies };
}

/** `MLB123…` → página do anúncio; id fora do padrão → null. */
export function mercadoLivreProductUrl(productId: string): string | null {
  if (!MERCADO_LIVRE_PRODUCT_ID.test(productId)) return null;
  return `https://produto.mercadolivre.com.br/MLB-${productId.slice(3)}`;
}

export function createMercadoLivreHuntAdapter(
  catalog: IHuntCatalogSource = new MercadoLivreHubClient(),
): IHuntProviderAdapter {
  return {
    provider: 'MERCADO_LIVRE',
    capabilities: MERCADO_LIVRE_HUNT_CAPABILITIES,
    imageHosts: MERCADO_LIVRE_HUNT_CAPABILITIES.imageHosts,
    catalog,
    sessionFrom: mercadoLivreSessionFrom,
    productUrl: mercadoLivreProductUrl,
  };
}
