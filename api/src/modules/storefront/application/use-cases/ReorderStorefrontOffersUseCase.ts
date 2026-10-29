import type { StorefrontOfferStatus } from '../../domain/enums/StorefrontEnums';
import { StorefrontOrderInvalidError } from '../../../../shared/errors/internal/StorefrontErrors';
import { requireStorefront, requireStorefrontEnabled, type StorefrontUseCaseDeps } from './storefrontUseCaseDeps';

type Deps = Pick<StorefrontUseCaseDeps, 'storefronts' | 'offers' | 'entitlements'>;

export interface ReorderStorefrontOffersDTO {
  tenantId: string;
  status: StorefrontOfferStatus;
  /** Lista completa da aba na nova ordem. */
  ids: readonly string[];
}

/** Grava a ordem da aba. Exige exatamente os ids da aba (sem faltar, repetir ou sobrar). */
export class ReorderStorefrontOffersUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: ReorderStorefrontOffersDTO): Promise<void> {
    await requireStorefrontEnabled(this.deps.entitlements, input.tenantId);
    const { storefronts, offers } = this.deps;
    const { tenantId, status, ids } = input;

    const page = await requireStorefront(storefronts, tenantId);
    const current = await offers.listIdsByStatus(tenantId, page.id, status);
    const given = new Set(ids);
    if (given.size !== ids.length || ids.length !== current.length || current.some((id) => !given.has(id))) {
      throw new StorefrontOrderInvalidError();
    }
    await offers.setPositions(tenantId, page.id, ids);
  }
}
