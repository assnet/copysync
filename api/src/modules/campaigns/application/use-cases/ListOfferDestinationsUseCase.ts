import type { IOfferDestinationRepository } from '../../domain/contracts/IOfferDestinationRepository';
import type { OfferDestinationView } from '../../domain/entities/OfferDestination';

/** Destinos padrão das ofertas, com nome/sessão para o seletor. */
export class ListOfferDestinationsUseCase {
  constructor(private readonly destinations: IOfferDestinationRepository) {}

  execute(tenantId: string): Promise<OfferDestinationView[]> {
    return this.destinations.list(tenantId);
  }
}
