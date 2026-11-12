import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { MarketplaceRiskScope } from '../../../integrations/domain/enums/MarketplaceRiskScope';
import { DEFAULT_MARKETPLACE_RISK_SCOPE } from '../../../integrations/domain/enums/MarketplaceRiskScope';
import type { OfferAffiliateCredential } from '../../domain/contracts/IAffiliateCredentialResolver';
import type { IMercadoLivreAffiliateClient } from '../../domain/contracts/IMercadoLivreAffiliateClient';
import type { IProductPageReader } from '../../domain/contracts/IProductPageReader';
import type { IShopeeAffiliateClient } from '../../domain/contracts/IShopeeAffiliateClient';
import type { ISheinAffiliateClient } from '../../domain/contracts/ISheinAffiliateClient';
import type { IMarketplaceRiskGate } from '../../domain/contracts/IMarketplaceRiskGate';
import { requiresRiskAcceptance } from '../../../integrations/domain/services/marketplaceRiskNotice';
import { isSupportedShareLink } from '../../domain/services/isSupportedShareLink';
import { parseProductRef, type ProductRef } from '../../domain/services/parseProductRef';
import { logger } from '../../../../shared/logger/logger';

/**
 * Dados do produto que já vieram na página lida para achar o id (vitrine social do ML). Quem
 * consome usa antes de reler a página do produto: a página `/p/MLB…` cai no captcha do ML para
 * o servidor na maior parte das vezes, e a vitrine já trouxe título, preços e foto.
 */
export interface TenantLinkProductData {
  title: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  /** URL externa (mlstatic), ainda fora do media store. */
  imageUrl: string | null;
}

export type ComposedTenantLink =
  | {
      kind: 'ok';
      provider: AffiliateProvider;
      sourceUrl: string;
      affiliateUrl: string;
      /** Id do produto usado: ASIN, `shopId.itemId`, `MLB…` (inclusive o da vitrine social) ou `goodsId`. */
      productRef: string;
      product?: TenantLinkProductData;
    }
  | { kind: 'unsupported' }
  | { kind: 'credential_missing'; provider: AffiliateProvider }
  | { kind: 'risk_not_accepted'; provider: AffiliateProvider }
  | { kind: 'failed'; provider: AffiliateProvider; code: string };

export interface ComposeTenantLinkInput {
  tenantId: string;
  provider: AffiliateProvider;
  /** URL já expandida (final). */
  final: URL;
  cred: OfferAffiliateCredential;
  /** Etiqueta do ML para o link; ausente = principal da credencial. */
  mlTag?: string;
  /**
   * Aviso de risco cobrado (ausente = `AFFILIATE_LINK`). O caçador passa `OFFER_HUNTER` e só o aceite
   * dele é cobrado; gerador, vitrine, story e monitoramento não passam nada.
   */
  riskScope?: MarketplaceRiskScope;
}

export interface TenantAffiliateLinkComposerDeps {
  shopee: IShopeeAffiliateClient;
  mercadoLivre: IMercadoLivreAffiliateClient;
  pageReader: IProductPageReader;
  shein: ISheinAffiliateClient;
  riskGate: IMarketplaceRiskGate;
}

const AMAZON_DEFAULT_HOST = 'www.amazon.com.br';

/**
 * Núcleo do link do tenant: marketplace + URL final + credencial já lida → link de afiliado DO TENANT.
 *
 * Nada da URL de origem sobrevive além do produto: a URL é reconstruída na forma canônica, sem
 * query (some `tag`, `matt_word`, `matt_tool`, `af_*`, `utm_*`…), e só então recebe a marcação do
 * tenant. Sem expandir, sem gate de plano, sem `markRejected`, sem log de URL: `AppError` da loja
 * sobe e quem chama decide pausar ou avisar.
 */
export class TenantAffiliateLinkComposer {
  constructor(private readonly deps: TenantAffiliateLinkComposerDeps) {}

  async compose(input: ComposeTenantLinkInput): Promise<ComposedTenantLink> {
    const { tenantId, provider, final, cred } = input;
    switch (provider) {
      case 'AMAZON': {
        const ref = parseProductRef(provider, final);
        if (ref?.provider !== 'AMAZON') return { kind: 'unsupported' };
        const host = final.hostname === 'amazon.com.br' || final.hostname.endsWith('.amazon.com.br') ? final.hostname : AMAZON_DEFAULT_HOST;
        const sourceUrl = `https://${host}/dp/${ref.asin}`;
        return {
          kind: 'ok', provider, sourceUrl, productRef: ref.asin,
          affiliateUrl: `${sourceUrl}?tag=${encodeURIComponent(cred.publicIdentifier)}`,
        };
      }
      case 'SHOPEE': {
        const ref = parseProductRef(provider, final);
        if (ref?.provider !== 'SHOPEE') return { kind: 'unsupported' };
        if (!cred.secret) return { kind: 'credential_missing', provider };
        const sourceUrl = `https://shopee.com.br/product/${ref.shopId}/${ref.itemId}`;
        const affiliateUrl = await this.deps.shopee.generateShortLink({ appId: cred.publicIdentifier, secret: cred.secret }, sourceUrl);
        return { kind: 'ok', provider, sourceUrl, affiliateUrl, productRef: `${ref.shopId}.${ref.itemId}` };
      }
      case 'MERCADO_LIVRE': {
        const cookies = cred.session?.cookies;
        if (!cookies) return { kind: 'credential_missing', provider };
        let ref = parseProductRef(provider, final);
        let product: TenantLinkProductData | undefined;
        if (!ref) ({ ref, product } = await this.mlRefFromPage(final));
        if (ref?.provider !== 'MERCADO_LIVRE') return { kind: 'unsupported' };
        const sourceUrl = ref.catalog
          ? `https://www.mercadolivre.com.br/p/${ref.itemId}`
          : `https://produto.mercadolivre.com.br/MLB-${ref.itemId.replace(/^MLB-?/i, '')}`;
        const tag = input.mlTag || cred.publicIdentifier || undefined;
        const result = await this.deps.mercadoLivre.createAffiliateLinks(cookies, [sourceUrl], tag);
        const link = result.success[0]?.shortUrl;
        if (!link) {
          // Código por item da ML (100 URL Invalid, 1001 tipo, 1004 fechado, 1008 condição) — ver docs/extensao-ml-endpoints.md
          const mlError = result.errors[0];
          const code = mlError ? `ML_${mlError.errorCode}` : 'AFFILIATE_LINK_NOT_CREATED';
          logger.warn({ code, provider }, 'tenant affiliate link not built');
          return { kind: 'failed', provider, code };
        }
        return { kind: 'ok', provider, sourceUrl, affiliateUrl: link, productRef: ref.itemId, ...(product ? { product } : {}) };
      }
      case 'SHEIN': {
        const ref = parseProductRef(provider, final);
        if (ref?.provider !== 'SHEIN') return { kind: 'unsupported' };
        const token = cred.session?.cookies?.AT;
        if (!token) return { kind: 'credential_missing', provider };
        const scope = input.riskScope ?? DEFAULT_MARKETPLACE_RISK_SCOPE;
        if (requiresRiskAcceptance(provider, scope) && !(await this.deps.riskGate.isAccepted(tenantId, provider, scope))) {
          return { kind: 'risk_not_accepted', provider };
        }
        const share = await this.deps.shein.getProductShare({ token, memberId: cred.publicIdentifier }, ref.goodsId);
        // O monitor trata todo `ok` como link do tenant: revalida o host antes de devolver
        if (!share || !isSupportedShareLink(share.affiliateUrl)) {
          logger.warn({ code: 'SHEIN_LINK_NOT_CREATED', provider }, 'tenant affiliate link not built');
          return { kind: 'failed', provider, code: 'SHEIN_LINK_NOT_CREATED' };
        }
        // Só referência interna (registro e comparação): a página cai em desafio e nunca é requisitada
        const sourceUrl = `https://br.shein.com/product-p-${ref.goodsId}.html`;
        return {
          kind: 'ok', provider, sourceUrl, affiliateUrl: share.affiliateUrl, productRef: ref.goodsId,
          product: { title: share.title, priceCents: share.priceCents, originalPriceCents: share.originalPriceCents, imageUrl: share.imageUrl },
        };
      }
    }
  }

  /**
   * Página "social" (vitrine de afiliado): o produto vem do 1º card. `product_id` é id de **catálogo**
   * (`/p/MLB…`; `produto…/MLB-<product_id>` não existe, ML 100); item fora de catálogo vem só com
   * `metadata.id` e vira `produto…/MLB-<id>`.
   * A vitrine é pública: lida sem cookie (página com cookie do servidor cai no captcha, spike §7).
   */
  private async mlRefFromPage(final: URL): Promise<{ ref: ProductRef | null; product?: TenantLinkProductData }> {
    if (!final.pathname.startsWith('/social/')) return { ref: null };
    const page = await this.deps.pageReader.read({ url: final });
    const id = page?.productRef ? /MLB-?(\d+)/i.exec(page.productRef)?.[1] : null;
    if (!id || !page) return { ref: null };
    const hasData = page.title != null || page.priceCents != null || page.imageUrl != null;
    return {
      ref: { provider: 'MERCADO_LIVRE', itemId: `MLB${id}`, catalog: page.productRefCatalog !== false },
      ...(hasData ? { product: { title: page.title, priceCents: page.priceCents, originalPriceCents: page.originalPriceCents, imageUrl: page.imageUrl } } : {}),
    };
  }
}
