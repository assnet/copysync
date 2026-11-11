import type { StorefrontOffer } from '../../domain/entities/StorefrontOffer';
import { StorefrontOfferStatus } from '../../domain/enums/StorefrontEnums';
import {
  keepOfferCategory,
  STOREFRONT_MAX_OFFERS,
  STOREFRONT_OFFER_TITLE_MAX_LENGTH,
} from '../../domain/services/storefrontRules';
import { StorefrontOfferLimitError } from '../../../../shared/errors/internal/StorefrontErrors';
import { AppError } from '../../../../shared/errors/AppError';
import { logger } from '../../../../shared/logger/logger';
import { requireStorefront, requireStorefrontEnabled, type StorefrontUseCaseDeps } from './storefrontUseCaseDeps';

type Deps = Pick<
  StorefrontUseCaseDeps,
  'storefronts' | 'offers' | 'entitlements' | 'images' | 'media' | 'resolveProduct' | 'imageFetcher'
>;

export interface ExtractStorefrontOfferInput {
  tenantId: string;
  url: string;
  category?: string | null;
}

export interface ExtractStorefrontOfferResult {
  offer: StorefrontOffer;
  /** O link colado era de outro afiliado e foi recriado com a credencial do tenant. */
  linkRebuilt: boolean;
}

/**
 * Link colado → rascunho no fim da aba. Link só pela regra do gerador (`ResolveAffiliateProductUseCase`):
 * devolve sempre o link do tenant (recriado se for de outro afiliado) ou lança erro — nunca grava link
 * de terceiro, então o item nasce `attributionVerified = true`. Imagem é melhor esforço.
 */
export class ExtractStorefrontOfferUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: ExtractStorefrontOfferInput): Promise<ExtractStorefrontOfferResult> {
    const { storefronts, offers, entitlements } = this.deps;
    const { tenantId } = input;

    await requireStorefrontEnabled(entitlements, tenantId);
    const page = await requireStorefront(storefronts, tenantId);
    const counts = await offers.countByStorefront(tenantId, page.id);
    if (counts.total >= STOREFRONT_MAX_OFFERS) throw new StorefrontOfferLimitError(STOREFRONT_MAX_OFFERS);

    const resolved = await this.deps.resolveProduct.execute(tenantId, input.url);
    const imageUrl = resolved.product.imageSourceUrl ? await this.storeImage(resolved.product.imageSourceUrl) : null;

    // Posição lida por último: extração lenta não pega a mesma posição de outra recém-criada
    const max = await offers.maxPosition(tenantId, page.id, StorefrontOfferStatus.DRAFT);
    const offer = await offers.create({
      tenantId,
      storefrontId: page.id,
      status: StorefrontOfferStatus.DRAFT,
      position: (max ?? -1) + 1,
      provider: resolved.provider,
      sourceUrl: resolved.sourceUrl,
      affiliateUrl: resolved.affiliateUrl,
      attributionVerified: true,
      // Sem título do marketplace: vazio, o tenant completa na edição
      title: (resolved.product.title ?? '').trim().slice(0, STOREFRONT_OFFER_TITLE_MAX_LENGTH),
      priceCents: resolved.product.priceCents,
      originalPriceCents: resolved.product.originalPriceCents,
      imageUrl,
      category: keepOfferCategory(input.category ?? null, page.categories),
    });
    return { offer, linkRebuilt: resolved.linkRebuilt };
  }

  private async storeImage(sourceUrl: string): Promise<string | null> {
    try {
      const fetched = await this.deps.imageFetcher.fetch(sourceUrl);
      if (!fetched) return null;
      const processed = await this.deps.images.process(fetched.buffer, 'offer');
      return await this.deps.media.save(processed.buffer);
    } catch (err) {
      // Sem URL no log (link externo do marketplace)
      logger.warn({ err: err instanceof AppError ? err.code : String(err) }, 'storefront offer image skipped');
      return null;
    }
  }
}
