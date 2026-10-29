import type { IShortLinkExpander } from '../../domain/contracts/IShortLinkExpander';
import type { IMercadoLivreAffiliateClient } from '../../domain/contracts/IMercadoLivreAffiliateClient';
import type {
  IAffiliateCredentialResolver,
  OfferAffiliateCredential,
} from '../../domain/contracts/IAffiliateCredentialResolver';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import { detectMarketplace, isSupportedProductUrl } from '../../domain/services/detectMarketplace';
import { parseProductRef } from '../../domain/services/parseProductRef';
import { verifyAffiliateLink, type AffiliateLinkCheck } from '../../domain/services/verifyAffiliateLink';
import {
  OfferLinkNotAffiliateError,
  OfferLinkNotOwnedError,
  OfferUrlUnsupportedError,
} from '../../../../shared/errors/internal/OfferErrors';
import { AppError } from '../../../../shared/errors/AppError';
import { logger } from '../../../../shared/logger/logger';
import type { ProductData, ResolveProductDataUseCase } from './ResolveProductDataUseCase';

export interface ResolveAffiliateProductDeps {
  expander: IShortLinkExpander;
  credentials: IAffiliateCredentialResolver;
  mercadoLivre: IMercadoLivreAffiliateClient;
  products: ResolveProductDataUseCase;
}

export interface ResolvedAffiliateProduct {
  provider: AffiliateProvider;
  /** URL colada, normalizada. */
  sourceUrl: string;
  /** Link que vai na oferta: o colado, ou o gerado (ML com sessão). */
  affiliateUrl: string;
  attributionVerified: boolean;
  /** Dados do produto; a foto vem só como URL externa (`imageSourceUrl`), sem baixar. */
  product: ProductData;
}

/**
 * Link colado → marketplace, dono do link e dados do produto (melhor esforço). Não baixa nem grava
 * imagem: quem chama decide o store. Lança antes de qualquer gravação: URL fora da allowlist,
 * produto não reconhecido, link de outro afiliado ou sem afiliação.
 */
export class ResolveAffiliateProductUseCase {
  constructor(private readonly deps: ResolveAffiliateProductDeps) {}

  async execute(tenantId: string, rawUrl: string): Promise<ResolvedAffiliateProduct> {
    // URL: allowlist antes de qualquer requisição; expande e revalida
    const source = parseUrl(rawUrl);
    if (!isSupportedProductUrl(source)) throw new OfferUrlUnsupportedError();
    const final = await this.deps.expander.expand(source);
    const provider = detectMarketplace(final);
    if (!provider) throw new OfferUrlUnsupportedError();
    const ref = parseProductRef(provider, final);
    const mlSocial = provider === 'MERCADO_LIVRE' && final.pathname.startsWith('/social/');
    if (!ref && !mlSocial) throw new OfferUrlUnsupportedError('Product not recognized');

    // Dono do link. Sem credencial do marketplace: não bloqueia, só não verifica
    const cred = await this.deps.credentials.execute(tenantId, provider);
    const check = this.checkOwnership(provider, source, final, cred);
    if (check === 'not_owned') throw new OfferLinkNotOwnedError(provider);

    let affiliateUrl = source.toString();
    let attributionVerified = check === 'verified';

    if (check === 'not_affiliate') {
      const generated = provider === 'MERCADO_LIVRE' && cred?.session?.cookies
        ? await this.generateMlAffiliateLink(cred, final)
        : null;
      if (!generated) throw new OfferLinkNotAffiliateError(provider);
      affiliateUrl = generated;
      attributionVerified = true;
    }

    const product = await this.deps.products.resolve(provider, ref, final, cred);
    return { provider, sourceUrl: source.toString(), affiliateUrl, attributionVerified, product };
  }

  private async generateMlAffiliateLink(
    cred: OfferAffiliateCredential,
    productUrl: URL,
  ): Promise<string | null> {
    if (!cred.session?.cookies) return null;
    try {
      const result = await this.deps.mercadoLivre.createAffiliateLinks(
        cred.session.cookies,
        [productUrl.toString()],
        cred.publicIdentifier || undefined,
      );
      return result.success[0]?.shortUrl ?? null;
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      logger.warn({ code: err.code, provider: 'MERCADO_LIVRE' }, 'ML affiliate link generation failed');
      return null;
    }
  }

  /** Confere URL colada e final juntas: qualquer identificador divergente entre elas é `not_owned`. */
  private checkOwnership(
    provider: AffiliateProvider,
    source: URL,
    final: URL,
    cred: OfferAffiliateCredential | null,
  ): AffiliateLinkCheck {
    return verifyAffiliateLink(provider, final === source ? [final] : [source, final], cred?.publicIdentifier ?? null);
  }
}

function parseUrl(raw: string): URL {
  try {
    return new URL(raw.trim());
  } catch {
    throw new OfferUrlUnsupportedError();
  }
}
