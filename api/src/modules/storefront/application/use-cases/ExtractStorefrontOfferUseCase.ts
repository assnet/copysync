import type { StorefrontOffer } from '../../domain/entities/StorefrontOffer';
import { StorefrontOfferStatus } from '../../domain/enums/StorefrontEnums';
import {
  keepOfferCategory,
  STOREFRONT_MAX_OFFERS,
  STOREFRONT_OFFER_TITLE_MAX_LENGTH,
} from '../../domain/services/storefrontRules';
import type { ResolvedAffiliateProduct } from '../../../campaigns/application/use-cases/ResolveAffiliateProductUseCase';
import { StorefrontOfferLimitError } from '../../../../shared/errors/internal/StorefrontErrors';
import { AppError } from '../../../../shared/errors/AppError';
import { logger } from '../../../../shared/logger/logger';
import { requireStorefront, requireStorefrontEnabled, type StorefrontUseCaseDeps } from './storefrontUseCaseDeps';

type Deps = Pick<
  StorefrontUseCaseDeps,
  'storefronts' | 'offers' | 'entitlements' | 'images' | 'media' | 'resolveProduct' | 'buildAffiliateLink' | 'imageFetcher'
>;

export interface ExtractStorefrontOfferInput {
  tenantId: string;
  url: string;
  category?: string | null;
}

/**
 * Link colado → rascunho no fim da aba. Regra de link do gerador (`ResolveAffiliateProductUseCase`),
 * exceto Shopee: com credencial o link é gerado para o tenant; sem ela (ou falha) grava o colado
 * com `attributionVerified = false`. Imagem é melhor esforço: falha não impede o rascunho.
 */
export class ExtractStorefrontOfferUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: ExtractStorefrontOfferInput): Promise<StorefrontOffer> {
    const { storefronts, offers, entitlements } = this.deps;
    const { tenantId } = input;

    await requireStorefrontEnabled(entitlements, tenantId);
    const page = await requireStorefront(storefronts, tenantId);
    const counts = await offers.countByStorefront(tenantId, page.id);
    if (counts.total >= STOREFRONT_MAX_OFFERS) throw new StorefrontOfferLimitError(STOREFRONT_MAX_OFFERS);

    const resolved = await this.deps.resolveProduct.execute(tenantId, input.url);
    const link = resolved.provider === 'SHOPEE' ? await this.shopeeLink(tenantId, resolved) : resolved;
    const imageUrl = resolved.product.imageSourceUrl ? await this.storeImage(resolved.product.imageSourceUrl) : null;

    // Posição lida por último: extração lenta não pega a mesma posição de outra recém-criada
    const max = await offers.maxPosition(tenantId, page.id, StorefrontOfferStatus.DRAFT);
    return offers.create({
      tenantId,
      storefrontId: page.id,
      status: StorefrontOfferStatus.DRAFT,
      position: (max ?? -1) + 1,
      provider: resolved.provider,
      sourceUrl: resolved.sourceUrl,
      affiliateUrl: link.affiliateUrl,
      attributionVerified: link.attributionVerified,
      // Sem título do marketplace: vazio, o tenant completa na edição
      title: (resolved.product.title ?? '').trim().slice(0, STOREFRONT_OFFER_TITLE_MAX_LENGTH),
      priceCents: resolved.product.priceCents,
      originalPriceCents: resolved.product.originalPriceCents,
      imageUrl,
      category: keepOfferCategory(input.category ?? null, page.categories),
    });
  }

  /** `ok` → link do tenant (verificado); qualquer outro resultado → link colado sem verificação. */
  private async shopeeLink(
    tenantId: string,
    resolved: ResolvedAffiliateProduct,
  ): Promise<{ affiliateUrl: string; attributionVerified: boolean }> {
    const pasted = { affiliateUrl: resolved.sourceUrl, attributionVerified: false };
    try {
      const built = await this.deps.buildAffiliateLink.execute(tenantId, resolved.sourceUrl);
      if (built.kind === 'ok') return { affiliateUrl: built.affiliateUrl, attributionVerified: true };
      logger.info({ kind: built.kind, provider: 'SHOPEE' }, 'storefront offer kept pasted link');
      return pasted;
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.warn({ err, provider: 'SHOPEE' }, 'storefront affiliate link build failed');
      return pasted;
    }
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
