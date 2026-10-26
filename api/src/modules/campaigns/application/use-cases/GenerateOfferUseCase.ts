import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';
import type { IOfferRepository, CreateOfferInput } from '../../domain/contracts/IOfferRepository';
import type { IShortLinkExpander } from '../../domain/contracts/IShortLinkExpander';
import type { IShopeeAffiliateClient, ShopeeCredential } from '../../domain/contracts/IShopeeAffiliateClient';
import type { IOfferImageFetcher } from '../../domain/contracts/IOfferImageFetcher';
import type { IOfferMediaStore } from '../../domain/contracts/IOfferMediaStore';
import type {
  IAffiliateCredentialResolver,
  OfferAffiliateCredential,
} from '../../domain/contracts/IAffiliateCredentialResolver';
import { detectMarketplace, isSupportedProductUrl } from '../../domain/services/detectMarketplace';
import { parseProductRef, type ProductRef } from '../../domain/services/parseProductRef';
import { buildAmazonAffiliateUrl, buildMercadoLivreAffiliateUrl } from '../../domain/services/buildAffiliateUrl';
import { renderOfferText } from '../../domain/services/renderOfferText';
import { startOfDayInZone } from '../../domain/services/startOfDayInZone';
import { OfferProductNotFoundError, OfferUrlUnsupportedError } from '../../../../shared/errors/internal/OfferErrors';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { AffiliateCredentialNotFoundError } from '../../../../shared/errors/internal/AffiliateCredentialErrors';
import { logger } from '../../../../shared/logger/logger';
import { toOfferDto, type OfferDTO } from '../dtos/OfferDTO';

export const OFFER_GENERATIONS_PER_DAY = 'offer_generations_per_day';

export interface GenerateOfferInput {
  tenantId: string;
  userId: string;
  url: string;
}

export interface GenerateOfferOutput {
  offer: OfferDTO;
  /** Amazon/ML: título, preço e foto vêm do operador. */
  needsManualData: boolean;
}

export interface GenerateOfferDeps {
  offers: IOfferRepository;
  entitlements: IEntitlementReader;
  expander: IShortLinkExpander;
  credentials: IAffiliateCredentialResolver;
  shopee: IShopeeAffiliateClient;
  imageFetcher: IOfferImageFetcher;
  mediaStore: IOfferMediaStore;
  now?: () => Date;
}

/** Dados do produto + link, antes de virar Offer. */
type ResolvedProduct = Pick<
  CreateOfferInput,
  'productRef' | 'title' | 'priceCents' | 'originalPriceCents' | 'imageUrl' | 'affiliateUrl' | 'attributionVerified'
>;

/**
 * Link de produto → Offer DRAFT (OFFER-01..05, 09). Grava só no fim: qualquer erro antes
 * (limite, URL, credencial, API do marketplace) não persiste nem conta no limite.
 */
export class GenerateOfferUseCase {
  private readonly now: () => Date;

  constructor(private readonly deps: GenerateOfferDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async execute(input: GenerateOfferInput): Promise<GenerateOfferOutput> {
    const { tenantId, userId } = input;

    // 1. Cota diária (null = ilimitado). Checagem cedo poupa chamadas de rede; a definitiva
    // é atômica na gravação (createWithinDailyLimit)
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
    if (!ref) throw new OfferUrlUnsupportedError('Product not recognized');

    // 3. Credencial do tenant
    const cred = await this.deps.credentials.execute(tenantId, provider);
    if (!cred) throw new AffiliateCredentialNotFoundError(provider);

    // 4. Produto + link de afiliado
    const product = await this.resolveProduct(ref, final, cred);

    // 5. Texto pelo modelo padrão e grava
    const text = renderOfferText({
      title: product.title,
      priceCents: product.priceCents,
      originalPriceCents: product.originalPriceCents,
      affiliateUrl: product.affiliateUrl,
    });
    const data: CreateOfferInput = {
      tenantId,
      provider,
      sourceUrl: source.toString(),
      ...product,
      text,
      createdById: userId,
    };
    const offer =
      limit === null
        ? await this.deps.offers.create(data)
        : await this.deps.offers.createWithinDailyLimit(data, { key: OFFER_GENERATIONS_PER_DAY, since, limit });
    return { offer: toOfferDto(offer), needsManualData: provider !== 'SHOPEE' };
  }

  private async resolveProduct(ref: ProductRef, final: URL, cred: OfferAffiliateCredential): Promise<ResolvedProduct> {
    switch (ref.provider) {
      case 'SHOPEE': {
        if (!cred.secret) throw new AffiliateCredentialNotFoundError('SHOPEE');
        const shopeeCred: ShopeeCredential = { appId: cred.publicIdentifier, secret: cred.secret };
        const shopeeRef = { shopId: ref.shopId, itemId: ref.itemId };
        const product = await this.deps.shopee.getProduct(shopeeCred, shopeeRef);
        if (!product) throw new OfferProductNotFoundError('SHOPEE');
        const origin = product.offerLink ?? `https://shopee.com.br/product/${ref.shopId}/${ref.itemId}`;
        const affiliateUrl = await this.deps.shopee.generateShortLink(shopeeCred, origin);
        return {
          productRef: `${ref.shopId}.${ref.itemId}`,
          title: product.title,
          priceCents: product.priceCents,
          originalPriceCents: product.originalPriceCents,
          imageUrl: product.imageUrl ? await this.storeImage(product.imageUrl) : null,
          affiliateUrl,
          attributionVerified: true,
        };
      }
      case 'AMAZON':
        return {
          ...emptyProduct(ref.asin),
          affiliateUrl: buildAmazonAffiliateUrl(ref.asin, cred.publicIdentifier),
          attributionVerified: true,
        };
      case 'MERCADO_LIVRE':
        // Atribuição por `matt_word` não confirmada pelo ML
        return {
          ...emptyProduct(ref.itemId),
          affiliateUrl: buildMercadoLivreAffiliateUrl(final, cred.publicIdentifier),
          attributionVerified: false,
        };
    }
  }

  /** Foto é opcional: falha vira oferta sem foto (o painel pede outra). */
  private async storeImage(url: string): Promise<string | null> {
    try {
      const image = await this.deps.imageFetcher.fetch(url);
      if (!image) return null;
      return await this.deps.mediaStore.saveImage(image.buffer, image.mimeType);
    } catch (err) {
      logger.warn({ err: (err as Error)?.name }, 'offer image store failed');
      return null;
    }
  }
}

function parseUrl(raw: string): URL {
  try {
    return new URL(raw.trim());
  } catch {
    throw new OfferUrlUnsupportedError();
  }
}

function emptyProduct(productRef: string) {
  return { productRef, title: null, priceCents: null, originalPriceCents: null, imageUrl: null };
}
