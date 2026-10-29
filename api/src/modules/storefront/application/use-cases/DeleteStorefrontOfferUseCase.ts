import { StorefrontNotFoundError } from '../../../../shared/errors/internal/StorefrontErrors';
import { requireStorefrontEnabled, type StorefrontUseCaseDeps } from './storefrontUseCaseDeps';

type Deps = Pick<StorefrontUseCaseDeps, 'offers' | 'media' | 'entitlements'>;

export interface DeleteStorefrontOfferDTO {
  tenantId: string;
  id: string;
}

/** Apaga a oferta e, depois, a imagem dela no storage (`remove` nunca lança). */
export class DeleteStorefrontOfferUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: DeleteStorefrontOfferDTO): Promise<void> {
    await requireStorefrontEnabled(this.deps.entitlements, input.tenantId);
    const { offers, media } = this.deps;
    const offer = await offers.findById(input.tenantId, input.id);
    if (!offer) throw new StorefrontNotFoundError(input.id);
    await offers.delete(input.tenantId, input.id);
    if (offer.imageUrl) await media.remove(offer.imageUrl);
  }
}
