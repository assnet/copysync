import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';
import type { IOfferRepository, CreateOfferInput } from '../../domain/contracts/IOfferRepository';
import type { IShortLinkExpander } from '../../domain/contracts/IShortLinkExpander';
import type { IShopeeAffiliateClient } from '../../domain/contracts/IShopeeAffiliateClient';
import type { IMercadoLivreAffiliateClient } from '../../domain/contracts/IMercadoLivreAffiliateClient';
import type { IOfferImageFetcher } from '../../domain/contracts/IOfferImageFetcher';
import type { IOfferMediaStore } from '../../domain/contracts/IOfferMediaStore';
import type { IProductPageReader } from '../../domain/contracts/IProductPageReader';
import type { IAffiliateCredentialResolver } from '../../domain/contracts/IAffiliateCredentialResolver';
import { OFFER_AUDIENCES, type OfferAudience } from '../../domain/enums/OfferAudience';
import { startOfDayInZone } from '../../domain/services/startOfDayInZone';
import { OfferInvalidInputError } from '../../../../shared/errors/internal/OfferErrors';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { toOfferDto, type OfferDTO } from '../dtos/OfferDTO';
import type { OfferTextComposer } from '../services/OfferTextComposer';
import { normalizeCoupon } from './offerCoupon';
import { parseOfferSchedule } from './offerScheduleInput';
import { ResolveProductDataUseCase } from './ResolveProductDataUseCase';
import { ResolveAffiliateProductUseCase } from './ResolveAffiliateProductUseCase';

export const OFFER_GENERATIONS_PER_DAY = ENTITLEMENT_KEYS.OFFER_GENERATIONS_PER_DAY;

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
  /** Passos 2–4 (URL, dono do link, dados): o mesmo caminho da página de ofertas. */
  private readonly affiliateProducts: ResolveAffiliateProductUseCase;

  constructor(private readonly deps: GenerateOfferDeps) {
    this.now = deps.now ?? (() => new Date());
    this.products = new ResolveProductDataUseCase({
      shopee: deps.shopee, pageReader: deps.pageReader, imageFetcher: deps.imageFetcher, mediaStore: deps.mediaStore,
    });
    this.affiliateProducts = new ResolveAffiliateProductUseCase({
      expander: deps.expander, credentials: deps.credentials, mercadoLivre: deps.mercadoLivre, products: this.products,
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

    // 2–4. URL, dono do link e dados do produto (melhor esforço); foto no store
    const { provider, sourceUrl, affiliateUrl, attributionVerified, product: data } =
      await this.affiliateProducts.execute(tenantId, input.url);
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
      sourceUrl,
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
}
