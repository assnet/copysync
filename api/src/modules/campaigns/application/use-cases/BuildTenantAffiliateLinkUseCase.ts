import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { IAffiliateCredentialResolver } from '../../domain/contracts/IAffiliateCredentialResolver';
import type { IMercadoLivreAffiliateClient } from '../../domain/contracts/IMercadoLivreAffiliateClient';
import type { IProductPageReader } from '../../domain/contracts/IProductPageReader';
import type { IShopeeAffiliateClient } from '../../domain/contracts/IShopeeAffiliateClient';
import type { IShortLinkExpander } from '../../domain/contracts/IShortLinkExpander';
import { detectMarketplace, isSupportedProductUrl } from '../../domain/services/detectMarketplace';
import { parseProductRef, type ProductRef } from '../../domain/services/parseProductRef';
import { AppError } from '../../../../shared/errors/AppError';
import { logger } from '../../../../shared/logger/logger';

export type TenantAffiliateLink =
  /** Não é link de produto de marketplace suportado (convite de grupo, outro site, vitrine…). */
  | { kind: 'unsupported' }
  | { kind: 'credential_missing'; provider: AffiliateProvider }
  | { kind: 'failed'; provider: AffiliateProvider | null; code: string }
  | { kind: 'ok'; provider: AffiliateProvider; sourceUrl: string; affiliateUrl: string };

export interface BuildTenantAffiliateLinkDeps {
  expander: IShortLinkExpander;
  credentials: IAffiliateCredentialResolver;
  shopee: IShopeeAffiliateClient;
  mercadoLivre: IMercadoLivreAffiliateClient;
  pageReader: IProductPageReader;
}

const AMAZON_DEFAULT_HOST = 'www.amazon.com.br';

/**
 * Link de produto de TERCEIRO (ex.: capturado de grupo concorrente) → link de afiliado DO TENANT.
 *
 * Nada da URL de origem sobrevive além do produto: a URL é reconstruída na forma canônica, sem
 * query (some `tag`, `matt_word`, `matt_tool`, `af_*`, `utm_*`…), e só então recebe a marcação do
 * tenant. Mercado Livre e Shopee geram o link pela API com a credencial do tenant; Amazon recebe
 * `?tag=` do tenant. Rede só dentro da allowlist (expansor e leitor de página).
 */
export class BuildTenantAffiliateLinkUseCase {
  constructor(private readonly deps: BuildTenantAffiliateLinkDeps) {}

  async execute(tenantId: string, href: string): Promise<TenantAffiliateLink> {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return { kind: 'unsupported' };
    }
    if (!isSupportedProductUrl(url)) return { kind: 'unsupported' };

    let final: URL;
    try {
      final = await this.deps.expander.expand(url);
    } catch (err) {
      return this.failure(null, err, 'LINK_EXPAND_FAILED');
    }
    const provider = detectMarketplace(final);
    if (!provider) return { kind: 'unsupported' };

    let cred;
    try {
      cred = await this.deps.credentials.execute(tenantId, provider);
    } catch (err) {
      return this.failure(provider, err, 'CREDENTIAL_UNREADABLE');
    }
    if (!cred) return { kind: 'credential_missing', provider };

    try {
      switch (provider) {
        case 'AMAZON': {
          const ref = parseProductRef(provider, final);
          if (ref?.provider !== 'AMAZON') return { kind: 'unsupported' };
          const host = final.hostname === 'amazon.com.br' || final.hostname.endsWith('.amazon.com.br') ? final.hostname : AMAZON_DEFAULT_HOST;
          const sourceUrl = `https://${host}/dp/${ref.asin}`;
          return { kind: 'ok', provider, sourceUrl, affiliateUrl: `${sourceUrl}?tag=${encodeURIComponent(cred.publicIdentifier)}` };
        }
        case 'SHOPEE': {
          const ref = parseProductRef(provider, final);
          if (ref?.provider !== 'SHOPEE') return { kind: 'unsupported' };
          if (!cred.secret) return { kind: 'credential_missing', provider };
          const sourceUrl = `https://shopee.com.br/product/${ref.shopId}/${ref.itemId}`;
          const affiliateUrl = await this.deps.shopee.generateShortLink({ appId: cred.publicIdentifier, secret: cred.secret }, sourceUrl);
          return { kind: 'ok', provider, sourceUrl, affiliateUrl };
        }
        case 'MERCADO_LIVRE': {
          const cookies = cred.session?.cookies;
          if (!cookies) return { kind: 'credential_missing', provider };
          const ref = parseProductRef(provider, final) ?? (await this.mlRefFromPage(final, cookies));
          if (ref?.provider !== 'MERCADO_LIVRE') return { kind: 'unsupported' };
          const sourceUrl = ref.catalog
            ? `https://www.mercadolivre.com.br/p/${ref.itemId}`
            : `https://produto.mercadolivre.com.br/MLB-${ref.itemId.replace(/^MLB-?/i, '')}`;
          const result = await this.deps.mercadoLivre.createAffiliateLinks(cookies, [sourceUrl], cred.publicIdentifier || undefined);
          const link = result.success[0]?.shortUrl;
          if (!link) {
            // Código por item da ML (100 URL Invalid, 1001 tipo, 1004 fechado, 1008 condição) — ver docs/extensao-ml-endpoints.md
            const mlError = result.errors[0];
            const code = mlError ? `ML_${mlError.errorCode}` : 'AFFILIATE_LINK_NOT_CREATED';
            logger.warn({ code, provider }, 'tenant affiliate link not built');
            return { kind: 'failed', provider, code };
          }
          return { kind: 'ok', provider, sourceUrl, affiliateUrl: link };
        }
      }
    } catch (err) {
      return this.failure(provider, err, 'AFFILIATE_LINK_FAILED');
    }
  }

  /**
   * Página "social" (vitrine de afiliado): o produto vem do `product_id` da página, que é id de
   * **catálogo** (`/p/MLB…`); `produto.mercadolivre.com.br/MLB-<product_id>` não existe (ML 100).
   * A vitrine é pública: lida sem cookie (página com cookie do servidor cai no captcha, spike §7).
   */
  private async mlRefFromPage(final: URL, _cookies: Record<string, string>): Promise<ProductRef | null> {
    if (!final.pathname.startsWith('/social/')) return null;
    const page = await this.deps.pageReader.read({ url: final });
    const id = page?.productRef ? /MLB-?(\d+)/i.exec(page.productRef)?.[1] : null;
    return id ? { provider: 'MERCADO_LIVRE', itemId: `MLB${id}`, catalog: true } : null;
  }

  private failure(provider: AffiliateProvider | null, err: unknown, fallback: string): TenantAffiliateLink {
    if (!(err instanceof AppError)) throw err;
    // Sem URL nem corpo no log (link de terceiro e resposta da API)
    logger.warn({ code: err.code, provider }, 'tenant affiliate link not built');
    return { kind: 'failed', provider, code: err.code || fallback };
  }
}
