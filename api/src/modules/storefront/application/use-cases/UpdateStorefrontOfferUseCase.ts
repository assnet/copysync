import type { StorefrontOffer } from '../../domain/entities/StorefrontOffer';
import type { UpdateStorefrontOfferInput } from '../../domain/contracts/IStorefrontOfferRepository';
import { keepOfferCategory, validateOfferTitle, validatePriceCents } from '../../domain/services/storefrontRules';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import { requireStorefront, requireStorefrontEnabled, type StorefrontUseCaseDeps } from './storefrontUseCaseDeps';

type Deps = Pick<StorefrontUseCaseDeps, 'storefronts' | 'offers' | 'entitlements'>;

export interface UpdateStorefrontOfferDTO extends UpdateStorefrontOfferInput {
  tenantId: string;
  id: string;
}

/**
 * Edita título (≤ 140), preço, preço "de" e categoria; ausente = não muda. Link não muda (apague
 * e cole de novo). Categoria fora das da página vira "Sem categoria", como na extração.
 */
export class UpdateStorefrontOfferUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: UpdateStorefrontOfferDTO): Promise<StorefrontOffer> {
    await requireStorefrontEnabled(this.deps.entitlements, input.tenantId);
    const { tenantId, id } = input;
    const patch: UpdateStorefrontOfferInput = {};

    if (input.title !== undefined) {
      const title = validateOfferTitle(input.title);
      if (title.kind === 'invalid') throw new ValidationError('Invalid offer title', { field: 'title' });
      patch.title = title.value;
    }
    for (const field of ['priceCents', 'originalPriceCents'] as const) {
      if (input[field] === undefined) continue;
      const price = validatePriceCents(input[field]);
      if (price.kind === 'invalid') throw new ValidationError('Invalid offer price', { field });
      patch[field] = price.value;
    }
    if (input.category !== undefined) {
      const page = await requireStorefront(this.deps.storefronts, tenantId);
      patch.category = keepOfferCategory(input.category, page.categories);
    }

    return this.deps.offers.update(tenantId, id, patch);
  }
}
