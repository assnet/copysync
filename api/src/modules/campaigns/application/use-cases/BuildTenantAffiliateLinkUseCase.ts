import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { IAffiliateCredentialGateway } from '../../domain/contracts/IAffiliateCredentialGateway';
import type { OfferAffiliateCredential } from '../../domain/contracts/IAffiliateCredentialResolver';
import type { IMercadoLivreAffiliateClient } from '../../domain/contracts/IMercadoLivreAffiliateClient';
import type { IProductPageReader } from '../../domain/contracts/IProductPageReader';
import type { IShopeeAffiliateClient } from '../../domain/contracts/IShopeeAffiliateClient';
import type { ISheinAffiliateClient } from '../../domain/contracts/ISheinAffiliateClient';
import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';
import type { IMarketplaceRiskGate } from '../../domain/contracts/IMarketplaceRiskGate';
import { requiresRiskAcceptance } from '../../../integrations/domain/services/marketplaceRiskNotice';
import { isMarketplaceEnabled } from '../services/requireMarketplaceEnabled';
import type { IShortLinkExpander } from '../../domain/contracts/IShortLinkExpander';
import { detectMarketplace, isSupportedProductUrl } from '../../domain/services/detectMarketplace';
import { isSupportedShareLink } from '../../domain/services/isSupportedShareLink';
import { marketplaceEntitlementKey } from '../../domain/services/marketplaceEntitlement';
import { parseProductRef, type ProductRef } from '../../domain/services/parseProductRef';
import { AppError } from '../../../../shared/errors/AppError';
import { logger } from '../../../../shared/logger/logger';

export type TenantAffiliateLink =
  /** Não é link de produto de marketplace suportado (convite de grupo, outro site, vitrine…). */
  | { kind: 'unsupported' }
  | { kind: 'credential_missing'; provider: AffiliateProvider }
  /** Marketplace fora do plano (da URL colada ou da final): nada é expandido, lido nem pedido à loja. */
  | { kind: 'plan_unavailable'; provider: AffiliateProvider }
  /** Com credencial, mas sem aceite da versão vigente do aviso de risco: nada é pedido à loja. */
  | { kind: 'risk_not_accepted'; provider: AffiliateProvider }
  /** Loja recusou a credencial (agora ou antes): nada é pedido à loja até o usuário reconfigurar. */
  | { kind: 'credential_rejected'; provider: AffiliateProvider; since: Date }
  | { kind: 'failed'; provider: AffiliateProvider | null; code: string }
  | { kind: 'ok'; provider: AffiliateProvider; sourceUrl: string; affiliateUrl: string; product?: TenantLinkProductData };

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

export interface BuildTenantAffiliateLinkDeps {
  expander: IShortLinkExpander;
  credentials: IAffiliateCredentialGateway;
  shopee: IShopeeAffiliateClient;
  mercadoLivre: IMercadoLivreAffiliateClient;
  pageReader: IProductPageReader;
  shein: ISheinAffiliateClient;
  entitlements: IEntitlementReader;
  riskGate: IMarketplaceRiskGate;
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

    // Plano antes de qualquer rede: o encurtador do marketplace travado (ex.: `onelink`) já é rede dele
    const pasted = detectMarketplace(url);
    if (pasted && marketplaceEntitlementKey(pasted)) {
      const blocked = await this.planBlocked(tenantId, pasted);
      if (blocked) return blocked;
    }

    let final: URL;
    try {
      final = await this.deps.expander.expand(url);
    } catch (err) {
      return this.failure(null, err, 'LINK_EXPAND_FAILED');
    }
    const provider = detectMarketplace(final);
    if (!provider) return { kind: 'unsupported' };

    // Ordem fixa: plano (na URL colada, antes de expandir; de novo aqui se o redirect mudou o marketplace)
    // → credencial → aceite → chamada à loja
    if (provider !== pasted) {
      const blocked = await this.planBlocked(tenantId, provider);
      if (blocked) return blocked;
    }

    let cred: OfferAffiliateCredential;
    try {
      const state = await this.deps.credentials.resolveState(tenantId, provider);
      // Loja pausada: credencial recusada antes, sem rede até o usuário reconfigurar
      if (state.state === 'rejected') return { kind: 'credential_rejected', provider, since: state.since };
      if (state.state === 'missing') return { kind: 'credential_missing', provider };
      cred = state.cred;
    } catch (err) {
      return this.failure(provider, err, 'CREDENTIAL_UNREADABLE');
    }

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
          let ref = parseProductRef(provider, final);
          let product: TenantLinkProductData | undefined;
          if (!ref) ({ ref, product } = await this.mlRefFromPage(final, cookies));
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
          return { kind: 'ok', provider, sourceUrl, affiliateUrl: link, ...(product ? { product } : {}) };
        }
        case 'SHEIN': {
          const ref = parseProductRef(provider, final);
          if (ref?.provider !== 'SHEIN') return { kind: 'unsupported' };
          const token = cred.session?.cookies?.AT;
          if (!token) return { kind: 'credential_missing', provider };
          if (requiresRiskAcceptance(provider) && !(await this.deps.riskGate.isAccepted(tenantId, provider))) {
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
            kind: 'ok', provider, sourceUrl, affiliateUrl: share.affiliateUrl,
            product: { title: share.title, priceCents: share.priceCents, originalPriceCents: share.originalPriceCents, imageUrl: share.imageUrl },
          };
        }
      }
    } catch (err) {
      // Loja recusou agora (401/403): pausa a loja; rate limit e indisponibilidade NÃO pausam
      if (err instanceof AppError && err.code === 'AFFILIATE_CREDENTIAL_REJECTED') {
        await this.deps.credentials.markRejected(tenantId, provider, err.code);
        logger.warn({ code: err.code, provider }, 'tenant affiliate credential rejected');
        return { kind: 'credential_rejected', provider, since: new Date() };
      }
      return this.failure(provider, err, 'AFFILIATE_LINK_FAILED');
    }
  }

  /**
   * Página "social" (vitrine de afiliado): o produto vem do 1º card. `product_id` é id de **catálogo**
   * (`/p/MLB…`; `produto…/MLB-<product_id>` não existe, ML 100); item fora de catálogo vem só com
   * `metadata.id` e vira `produto…/MLB-<id>`.
   * A vitrine é pública: lida sem cookie (página com cookie do servidor cai no captcha, spike §7).
   */
  private async mlRefFromPage(
    final: URL,
    _cookies: Record<string, string>,
  ): Promise<{ ref: ProductRef | null; product?: TenantLinkProductData }> {
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

  /** `plan_unavailable`/`failed` quando o plano trava o marketplace; null = liberado. */
  private async planBlocked(tenantId: string, provider: AffiliateProvider): Promise<TenantAffiliateLink | null> {
    try {
      return (await isMarketplaceEnabled(this.deps.entitlements, tenantId, provider)) ? null : { kind: 'plan_unavailable', provider };
    } catch (err) {
      return this.failure(provider, err, 'ENTITLEMENT_UNREADABLE');
    }
  }

  private failure(provider: AffiliateProvider | null, err: unknown, fallback: string): TenantAffiliateLink {
    if (!(err instanceof AppError)) throw err;
    // Sem URL nem corpo no log (link de terceiro e resposta da API)
    logger.warn({ code: err.code, provider }, 'tenant affiliate link not built');
    return { kind: 'failed', provider, code: err.code || fallback };
  }
}

