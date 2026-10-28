import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';
import type { IOfferRepository, CreateOfferInput } from '../../domain/contracts/IOfferRepository';
import type { IShortLinkExpander } from '../../domain/contracts/IShortLinkExpander';
import type { IShopeeAffiliateClient } from '../../domain/contracts/IShopeeAffiliateClient';
import type { IMercadoLivreAffiliateClient } from '../../domain/contracts/IMercadoLivreAffiliateClient';
import type { IOfferImageFetcher } from '../../domain/contracts/IOfferImageFetcher';
import type { IOfferMediaStore } from '../../domain/contracts/IOfferMediaStore';
import type { IProductPageReader } from '../../domain/contracts/IProductPageReader';
import type {
  IAffiliateCredentialResolver,
  OfferAffiliateCredential,
} from '../../domain/contracts/IAffiliateCredentialResolver';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import { OFFER_AUDIENCES, type OfferAudience } from '../../domain/enums/OfferAudience';
import { detectMarketplace, isSupportedProductUrl } from '../../domain/services/detectMarketplace';
import { parseProductRef, type ProductRef } from '../../domain/services/parseProductRef';
import { verifyAffiliateLink, type AffiliateLinkCheck } from '../../domain/services/verifyAffiliateLink';
import { startOfDayInZone } from '../../domain/services/startOfDayInZone';
import {
  OfferInvalidInputError,
  OfferLinkNotAffiliateError,
  OfferLinkNotOwnedError,
  OfferUrlUnsupportedError,
} from '../../../../shared/errors/internal/OfferErrors';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { AppError } from '../../../../shared/errors/AppError';
import { logger } from '../../../../shared/logger/logger';
import { toOfferDto, type OfferDTO } from '../dtos/OfferDTO';
import type { OfferTextComposer } from '../services/OfferTextComposer';
import { normalizeCoupon } from './offerCoupon';
import { parseOfferSchedule } from './offerScheduleInput';
import { ResolveProductDataUseCase } from './ResolveProductDataUseCase';

export const OFFER_GENERATIONS_PER_DAY = 'offer_generations_per_day';

export interface GenerateOfferInput {
  tenantId: string;
  userId: string;
  url: string;
  coupon?: string | null;
  audience?: OfferAudience;
  /** Início agendado dos disparos (ISO); ausente/null = começa ao disparar. */
  scheduledAt?: string | null;
}

export interface GenerateOfferOutput {
  offer: OfferDTO;
  /** Faltou título, preço ou foto: o operador completa. */
  needsManualData: boolean;
  /** Público pedia IA, mas o texto saiu do modelo fixo. */
  aiFallback: boolean;
  aiErrorCode?: string;
}

export interface GenerateOfferDeps {
  offers: IOfferRepository;
  entitlements: IEntitlementReader;
  expander: IShortLinkExpander;
  credentials: IAffiliateCredentialResolver;
  shopee: IShopeeAffiliateClient;
  mercadoLivre: IMercadoLivreAffiliateClient;
  pageReader: IProductPageReader;
  imageFetcher: IOfferImageFetcher;
  mediaStore: IOfferMediaStore;
  texts: OfferTextComposer;
  now?: () => Date;
}

/**
 * Link de afiliado colado → Offer DRAFT (GEN-02..04). O link colado É o link enviado: nada é
 * gerado. Grava só no fim: erro antes (limite, URL, dono do link) não persiste nem conta no limite.
 */
export class GenerateOfferUseCase {
  private readonly now: () => Date;
  /** Dados do produto e foto: o mesmo caminho do monitoramento (`ResolveProductDataUseCase`). */
  private readonly products: ResolveProductDataUseCase;

  constructor(private readonly deps: GenerateOfferDeps) {
    this.now = deps.now ?? (() => new Date());
    this.products = new ResolveProductDataUseCase({
      shopee: deps.shopee, pageReader: deps.pageReader, imageFetcher: deps.imageFetcher, mediaStore: deps.mediaStore,
    });
  }

  async execute(input: GenerateOfferInput): Promise<GenerateOfferOutput> {
    const { tenantId, userId } = input;
    const coupon = normalizeCoupon(input.coupon);
    const audience = input.audience ?? 'STANDARD';
    if (!OFFER_AUDIENCES.includes(audience)) throw new OfferInvalidInputError('Unknown audience', 'audience');
    const scheduledAt = parseOfferSchedule(input.scheduledAt, this.now()) ?? null;

    // 1. Cota diária (null = ilimitado). Checagem cedo poupa rede; a definitiva é atômica na gravação
    const limit = await this.deps.entitlements.getNumber(tenantId, OFFER_GENERATIONS_PER_DAY);
    const since = startOfDayInZone(this.now());
    if (limit !== null) {
      const used = await this.deps.offers.countCreatedSince(tenantId, since);
      if (used >= limit) throw new PlanLimitReachedError(OFFER_GENERATIONS_PER_DAY, limit);
    }

    // 2. URL: allowlist antes de qualquer requisição; expande e revalida
    const source = parseUrl(input.url);
    if (!isSupportedProductUrl(source)) throw new OfferUrlUnsupportedError();
    const final = await this.deps.expander.expand(source);
    const provider = detectMarketplace(final);
    if (!provider) throw new OfferUrlUnsupportedError();
    const ref = parseProductRef(provider, final);
    const mlSocial = provider === 'MERCADO_LIVRE' && final.pathname.startsWith('/social/');
    if (!ref && !mlSocial) throw new OfferUrlUnsupportedError('Product not recognized');

    // 3. Dono do link. Sem credencial do marketplace: não bloqueia, só não verifica
    const cred = await this.deps.credentials.execute(tenantId, provider);
    const check = this.checkOwnership(provider, source, final, cred);
    if (check === 'not_owned') throw new OfferLinkNotOwnedError(provider);

    let affiliateUrl = source.toString();
    let attributionVerified = check === 'verified';

    if (check === 'not_affiliate') {
      if (provider === 'MERCADO_LIVRE' && cred?.session?.cookies) {
        const generated = await this.generateMlAffiliateLink(cred, final);
        if (generated) {
          affiliateUrl = generated;
          attributionVerified = true;
        } else {
          throw new OfferLinkNotAffiliateError(provider);
        }
      } else {
        throw new OfferLinkNotAffiliateError(provider);
      }
    }

    // 4. Dados do produto (melhor esforço) + foto no store
    const data = await this.products.resolve(provider, ref, final, cred);
    const imageUrl = data.imageSourceUrl ? await this.products.storeImage(data.imageSourceUrl) : null;

    // 5. Texto (modelo ou IA) e grava
    const composed = await this.deps.texts.compose({
      tenantId,
      audience,
      title: data.title,
      priceCents: data.priceCents,
      originalPriceCents: data.originalPriceCents,
      coupon,
      affiliateUrl,
    });
    const row: CreateOfferInput = {
      tenantId,
      provider,
      sourceUrl: source.toString(),
      productRef: data.productRef,
      title: data.title,
      priceCents: data.priceCents,
      originalPriceCents: data.originalPriceCents,
      imageUrl,
      affiliateUrl,
      attributionVerified,
      text: composed.text,
      coupon,
      audience,
      scheduledAt,
      createdById: userId,
    };
    let offer;
    try {
      offer =
        limit === null
          ? await this.deps.offers.create(row)
          : await this.deps.offers.createWithinDailyLimit(row, { key: OFFER_GENERATIONS_PER_DAY, since, limit });
    } catch (err) {
      if (imageUrl) await this.products.discardImage(imageUrl);
      throw err;
    }
    return {
      offer: toOfferDto(offer),
      needsManualData: !offer.title || offer.priceCents == null || !offer.imageUrl,
      aiFallback: composed.aiFallback,
      ...(composed.aiErrorCode ? { aiErrorCode: composed.aiErrorCode } : {}),
    };
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
