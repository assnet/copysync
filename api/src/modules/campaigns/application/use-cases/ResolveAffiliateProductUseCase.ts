import type { IShortLinkExpander } from '../../domain/contracts/IShortLinkExpander';
import type { IMercadoLivreAffiliateClient } from '../../domain/contracts/IMercadoLivreAffiliateClient';
import type { ISheinAffiliateClient } from '../../domain/contracts/ISheinAffiliateClient';
import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';
import type { IMarketplaceRiskGate } from '../../domain/contracts/IMarketplaceRiskGate';
import type {
  IAffiliateCredentialResolver,
  OfferAffiliateCredential,
} from '../../domain/contracts/IAffiliateCredentialResolver';
import type { IAffiliateCredentialGateway } from '../../domain/contracts/IAffiliateCredentialGateway';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import { detectMarketplace, isSupportedProductUrl } from '../../domain/services/detectMarketplace';
import { parseProductRef, type ProductRef } from '../../domain/services/parseProductRef';
import { currentRiskNoticeVersion, requiresRiskAcceptance } from '../../../integrations/domain/services/marketplaceRiskNotice';
import { requireMarketplaceEnabled } from '../services/requireMarketplaceEnabled';
import { marketplaceEntitlementKey } from '../../domain/services/marketplaceEntitlement';
import { isSupportedShareLink } from '../../domain/services/isSupportedShareLink';
import {
  ownershipIdentifiersOf,
  verifyAffiliateLink,
  type AffiliateLinkCheck,
} from '../../domain/services/verifyAffiliateLink';
import { effectiveLinkedIdentifiers } from '../../../integrations/domain/services/effectiveLinkedIdentifiers';
import { identifierLimitOf } from '../../../tenants/domain/services/affiliateIdentifierLimit';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import {
  OfferLinkNotAffiliateError,
  OfferLinkNotOwnedError,
  OfferUrlUnsupportedError,
  AffiliateCredentialRejectedError,
} from '../../../../shared/errors/internal/OfferErrors';
import { MarketplaceRiskNotAcceptedError } from '../../../../shared/errors/internal/MarketplaceRiskErrors';
import { AffiliateIdentifierNotLinkedError } from '../../../../shared/errors/internal/AffiliateCredentialErrors';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { AppError } from '../../../../shared/errors/AppError';
import { logger } from '../../../../shared/logger/logger';
import { EMPTY_PRODUCT_DATA, type ProductData, type ResolveProductDataUseCase } from './ResolveProductDataUseCase';

export interface ResolveAffiliateProductDeps {
  expander: IShortLinkExpander;
  /**
   * `resolveState` só para a Shein: credencial recusada não chama a loja.
   * Sem `markRejected` de propósito: quem pausa a loja é só o builder do monitoramento.
   */
  credentials: IAffiliateCredentialResolver & Pick<IAffiliateCredentialGateway, 'resolveState'>;
  mercadoLivre: IMercadoLivreAffiliateClient;
  products: ResolveProductDataUseCase;
  shein: ISheinAffiliateClient;
  /** Gate de plano por marketplace (`requireMarketplaceEnabled`). Obrigatório: opcional seria contornável. */
  entitlements: IEntitlementReader;
  /** Aceite do aviso de risco; só consultado com credencial e para provider com aviso. */
  riskGate: IMarketplaceRiskGate;
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
    // Marketplace fora do plano: antes de qualquer rede (o encurtador do marketplace travado já é rede dele)
    const pasted = detectMarketplace(source);
    if (pasted && marketplaceEntitlementKey(pasted)) await requireMarketplaceEnabled(this.deps.entitlements, tenantId, pasted);
    const final = await this.deps.expander.expand(source);
    const provider = detectMarketplace(final);
    if (!provider) throw new OfferUrlUnsupportedError();
    // De novo após o redirect: pode cair em outro marketplace; antes de ler credencial ou chamar a loja
    if (provider !== pasted) await requireMarketplaceEnabled(this.deps.entitlements, tenantId, provider);
    const ref = parseProductRef(provider, final);
    const mlSocial = provider === 'MERCADO_LIVRE' && final.pathname.startsWith('/social/');
    if (!ref && !mlSocial) throw new OfferUrlUnsupportedError('Product not recognized');

    // Dono do link. Sem credencial do marketplace: não bloqueia, só não verifica
    const cred = await this.readCredential(tenantId, provider);
    const owned = await this.ownedIdentifiers(tenantId, provider, cred);
    const urls = final === source ? [final] : [source, final];
    const check = verifyAffiliateLink(provider, urls, owned.identifiers);
    if (check === 'not_owned') {
      this.rejectUnlinkedAccountIdentifier(provider, urls, cred, owned);
      throw new OfferLinkNotOwnedError(provider);
    }
    // Aceite do aviso de risco: só com credencial (sem ela nada é pedido à loja)
    if (cred && requiresRiskAcceptance(provider) && !(await this.deps.riskGate.isAccepted(tenantId, provider))) {
      throw new MarketplaceRiskNotAcceptedError(provider, currentRiskNoticeVersion(provider) ?? '');
    }
    if (ref?.provider === 'SHEIN') return this.resolveShein(source, ref, check, cred);

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

  /**
   * Shein: a página do produto cai em desafio anti-bot, então os dados vêm só da API de afiliados
   * (1 chamada, com a sessão do tenant). Sem sessão: link colado e produto vazio (preenchimento manual).
   * Recusa já registrada lança antes (`readCredential`); recusa agora propaga. Quem pausa a loja é
   * só o builder do monitoramento.
   */
  private async resolveShein(
    source: URL,
    ref: Extract<ProductRef, { provider: 'SHEIN' }>,
    check: AffiliateLinkCheck,
    cred: OfferAffiliateCredential | null,
  ): Promise<ResolvedAffiliateProduct> {
    const sourceUrl = source.toString();
    const empty: ProductData = { ...EMPTY_PRODUCT_DATA, productRef: ref.goodsId };
    const token = cred?.session?.cookies?.AT;
    if (!cred || !token) {
      if (check === 'not_affiliate') throw new OfferLinkNotAffiliateError('SHEIN');
      return { provider: 'SHEIN', sourceUrl, affiliateUrl: sourceUrl, attributionVerified: check === 'verified', product: empty };
    }
    const share = await this.deps.shein.getProductShare({ token, memberId: cred.publicIdentifier }, ref.goodsId);
    // Link gerado fora da allowlist vale como não gerado (mesma revalidação do builder)
    if (!share || (check !== 'verified' && !isSupportedShareLink(share.affiliateUrl))) {
      if (check !== 'verified') throw new OfferLinkNotAffiliateError('SHEIN');
      return { provider: 'SHEIN', sourceUrl, affiliateUrl: sourceUrl, attributionVerified: true, product: empty };
    }
    return {
      provider: 'SHEIN',
      sourceUrl,
      // Link colado do próprio tenant fica; senão vai o gerado pela conta dele
      affiliateUrl: check === 'verified' ? sourceUrl : share.affiliateUrl,
      attributionVerified: true,
      product: {
        productRef: ref.goodsId,
        title: share.title,
        priceCents: share.priceCents,
        originalPriceCents: share.originalPriceCents,
        imageSourceUrl: share.imageUrl,
      },
    };
  }

  /**
   * Shein: `resolveState`, e recusa já registrada lança sem chamar a
   * loja (não marca nada aqui). Os outros: `execute`, como sempre.
   */
  private async readCredential(tenantId: string, provider: AffiliateProvider): Promise<OfferAffiliateCredential | null> {
    if (provider !== 'SHEIN') return this.deps.credentials.execute(tenantId, provider);
    const state = await this.deps.credentials.resolveState(tenantId, provider);
    if (state.state === 'rejected') throw new AffiliateCredentialRejectedError(provider);
    return state.state === 'ok' ? state.cred : null;
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

  /**
   * Identificadores que provam o dono. ML: principal + vinculadas sob o limite do plano
   * (`mercado_livre_affiliate_tags`; rebaixado ignora o excedente sem apagar). Demais: só a principal.
   */
  private async ownedIdentifiers(
    tenantId: string,
    provider: AffiliateProvider,
    cred: OfferAffiliateCredential | null,
  ): Promise<{ identifiers: string[]; limit: number }> {
    if (!cred) return { identifiers: [], limit: 1 };
    if (provider !== 'MERCADO_LIVRE') return { identifiers: [cred.publicIdentifier], limit: 1 };
    const limit = identifierLimitOf(
      await this.deps.entitlements.getNumber(tenantId, ENTITLEMENT_KEYS.MERCADO_LIVRE_AFFILIATE_TAGS),
    );
    return { identifiers: effectiveLinkedIdentifiers(cred.publicIdentifier, cred.linkedIdentifiers ?? [], limit), limit };
  }

  /**
   * `not_owned` com etiqueta da própria conta (ainda não vinculada): com vaga no plano pede para vincular;
   * sem vaga, limite do plano. Etiqueta de terceiro segue para `OFFER_LINK_NOT_OWNED`.
   */
  private rejectUnlinkedAccountIdentifier(
    provider: AffiliateProvider,
    urls: readonly URL[],
    cred: OfferAffiliateCredential | null,
    owned: { identifiers: string[]; limit: number },
  ): void {
    if (provider !== 'MERCADO_LIVRE' || !cred?.accountIdentifiers?.length) return;
    const found = new Set(ownershipIdentifiersOf(provider, urls).map((v) => v.trim().toLowerCase()));
    if (found.size !== 1) return;
    const [tag] = [...found];
    if (!cred.accountIdentifiers.some((v) => v.trim().toLowerCase() === tag)) return;
    const used = owned.identifiers.length;
    if (used < owned.limit) throw new AffiliateIdentifierNotLinkedError(provider, owned.limit, used);
    throw new PlanLimitReachedError(ENTITLEMENT_KEYS.MERCADO_LIVRE_AFFILIATE_TAGS, owned.limit);
  }
}

function parseUrl(raw: string): URL {
  try {
    return new URL(raw.trim());
  } catch {
    throw new OfferUrlUnsupportedError();
  }
}
