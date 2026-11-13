// Adaptador por marca do Caçador de Ofertas (design §3b). Tudo que muda de uma marca para outra fica atrás dele:
// sessão a partir da credencial, catálogo, URL do produto (pedido do link ao Resolve) e hosts de foto.
import type { HuntCapabilities, HuntProvider, HuntSourceSession, IHuntCatalogSource } from '../../hunter/HuntProvider';
import type { OfferAffiliateCredential } from '../IAffiliateCredentialResolver';

export interface IHuntProviderAdapter {
  readonly provider: HuntProvider;
  readonly capabilities: HuntCapabilities;
  /** Fonte de catálogo da marca (erros como `Affiliate*Error`). */
  readonly catalog: IHuntCatalogSource;
  /** Hosts https aceitos para foto (= `capabilities.imageHosts`). */
  readonly imageHosts: readonly string[];
  /**
   * Sessão da fonte a partir da credencial decifrada (Shein `{ token: AT, memberId }`; ML `{ cookies: { ssid } }`).
   * null = credencial sem sessão utilizável (portão "credencial" fechado). Nunca loga nem copia o segredo.
   */
  sessionFrom(credential: OfferAffiliateCredential): HuntSourceSession | null;
  /**
   * URL canônica do produto para pedir o link do tenant ao Resolve (nunca é buscada pelo caçador).
   * null = id fora do `productIdPattern` da marca.
   */
  productUrl(productId: string): string | null;
}

/** Registry das marcas do caçador (composição em `hunterContainer`). */
export interface IHuntProviderRegistry {
  get(provider: HuntProvider): IHuntProviderAdapter;
}
