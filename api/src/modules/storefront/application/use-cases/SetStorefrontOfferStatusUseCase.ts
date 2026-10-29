import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import type { StorefrontOffer } from '../../domain/entities/StorefrontOffer';
import { StorefrontOfferStatus } from '../../domain/enums/StorefrontEnums';
import { STOREFRONT_MAX_PUBLISHED_OFFERS } from '../../domain/services/storefrontRules';
import { StorefrontNotFoundError, StorefrontPublishedLimitError } from '../../../../shared/errors/internal/StorefrontErrors';
import { requireStorefrontEnabled, type StorefrontUseCaseDeps } from './storefrontUseCaseDeps';

type Deps = Pick<StorefrontUseCaseDeps, 'offers' | 'now' | 'entitlements'>;

export interface SetStorefrontOfferStatusDTO {
  tenantId: string;
  id: string;
  status: StorefrontOfferStatus;
}

/**
 * Publica/despublica: a oferta vai para o fim da aba de destino. Publicar respeita o limite de
 * 60 publicadas e grava `publishedAt`; despublicar limpa. Mesmo status = nada muda.
 */
export class SetStorefrontOfferStatusUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: SetStorefrontOfferStatusDTO): Promise<StorefrontOffer> {
    await requireStorefrontEnabled(this.deps.entitlements, input.tenantId);
    const { offers } = this.deps;
    const { tenantId, id, status } = input;

    const offer = await offers.findById(tenantId, id);
    if (!offer) throw new StorefrontNotFoundError(id);
    if (offer.status === status) return offer;

    const publishing = status === StorefrontOfferStatus.PUBLISHED;
    if (publishing) {
      // Rascunho sem título (marketplace não informou) não vai para a página pública.
      if (!offer.title.trim()) throw new ValidationError('Offer title is required to publish', { field: 'title' });
      const { published } = await offers.countByStorefront(tenantId, offer.storefrontId);
      if (published >= STOREFRONT_MAX_PUBLISHED_OFFERS) throw new StorefrontPublishedLimitError(STOREFRONT_MAX_PUBLISHED_OFFERS);
    }

    const max = await offers.maxPosition(tenantId, offer.storefrontId, status);
    return offers.setStatus(tenantId, id, {
      status,
      position: (max ?? -1) + 1,
      publishedAt: publishing ? (this.deps.now?.() ?? new Date()) : null,
    });
  }
}
