import type { IOfferImageFetcher } from '../../domain/contracts/IOfferImageFetcher';
import type { IOfferMediaStore } from '../../domain/contracts/IOfferMediaStore';
import type { IProductPageReader } from '../../domain/contracts/IProductPageReader';
import type { IShopeeAffiliateClient } from '../../domain/contracts/IShopeeAffiliateClient';
import type { OfferAffiliateCredential } from '../../domain/contracts/IAffiliateCredentialResolver';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { ProductRef } from '../../domain/services/parseProductRef';
import { AppError } from '../../../../shared/errors/AppError';
import { logger } from '../../../../shared/logger/logger';

export interface ProductData {
  productRef: string | null;
  title: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  /** URL externa da foto (antes de ir para o store). */
  imageSourceUrl: string | null;
}

export const EMPTY_PRODUCT_DATA: ProductData = { productRef: null, title: null, priceCents: null, originalPriceCents: null, imageSourceUrl: null };

export interface ResolveProductDataDeps {
  shopee: IShopeeAffiliateClient;
  pageReader: IProductPageReader;
  imageFetcher: IOfferImageFetcher;
  mediaStore: IOfferMediaStore;
}

export function productRefOf(ref: ProductRef): string {
  switch (ref.provider) {
    case 'SHOPEE':
      return `${ref.shopId}.${ref.itemId}`;
    case 'AMAZON':
      return ref.asin;
    case 'MERCADO_LIVRE':
      return ref.itemId;
  }
}

/**
 * Dados do produto (título, preços, foto) a partir da URL final, melhor esforço: Shopee pela API de
 * afiliados (com credencial), o resto pela página (`IProductPageReader`; ML vitrine social pelo 1º
 * card, página de produto ML pode cair no captcha). Nunca lança por falta de dado: campo ausente =
 * null. Usado pelo gerador e pelo monitoramento (oferta montada / reescrita com IA).
 */
export class ResolveProductDataUseCase {
  constructor(private readonly deps: ResolveProductDataDeps) {}

  async resolve(
    provider: AffiliateProvider,
    ref: ProductRef | null,
    final: URL,
    cred: OfferAffiliateCredential | null,
  ): Promise<ProductData> {
    const refId = ref ? productRefOf(ref) : null;

    if (ref?.provider === 'SHOPEE' && cred?.secret) {
      try {
        const product = await this.deps.shopee.getProduct(
          { appId: cred.publicIdentifier, secret: cred.secret },
          { shopId: ref.shopId, itemId: ref.itemId },
        );
        if (product) {
          return {
            productRef: refId,
            title: product.title,
            priceCents: product.priceCents,
            originalPriceCents: product.originalPriceCents,
            imageSourceUrl: product.imageUrl,
          };
        }
      } catch (err) {
        // API de afiliados com problema não impede a oferta: cai na página e no preenchimento manual
        if (!(err instanceof AppError)) throw err;
        logger.warn({ code: err.code, provider }, 'offer product API failed, reading page');
      }
    }

    const page = await this.deps.pageReader.read({
      url: final,
      mercadoLivreCookies: provider === 'MERCADO_LIVRE' ? (cred?.session?.cookies ?? null) : null,
    });
    if (!page) return { ...EMPTY_PRODUCT_DATA, productRef: refId };
    return {
      productRef: refId ?? page.productRef,
      title: page.title,
      priceCents: page.priceCents,
      originalPriceCents: page.originalPriceCents,
      imageSourceUrl: page.imageUrl,
    };
  }

  /** Foto é opcional: falha vira oferta sem foto. Devolve a URL no media store. */
  async storeImage(url: string): Promise<string | null> {
    try {
      const image = await this.deps.imageFetcher.fetch(url);
      if (!image) return null;
      return await this.deps.mediaStore.saveImage(image.buffer, image.mimeType);
    } catch (err) {
      logger.warn({ err: (err as Error)?.name }, 'offer image store failed');
      return null;
    }
  }

  async discardImage(url: string): Promise<void> {
    try {
      await this.deps.mediaStore.removeImage(url);
    } catch (err) {
      logger.warn({ err: (err as Error)?.name }, 'offer image discard failed');
    }
  }
}
