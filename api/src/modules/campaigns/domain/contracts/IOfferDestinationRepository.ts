import type { OfferDestinationView } from '../entities/OfferDestination';

export interface IOfferDestinationRepository {
  list(tenantId: string): Promise<OfferDestinationView[]>;
  /** Substitui todo o conjunto (transação). Posse dos ids validada antes, no use case. */
  replace(tenantId: string, conversationIds: string[]): Promise<void>;
  /** Subconjunto de `ids` que são conversas do tenant. */
  filterOwnedConversations(tenantId: string, ids: string[]): Promise<string[]>;
}
