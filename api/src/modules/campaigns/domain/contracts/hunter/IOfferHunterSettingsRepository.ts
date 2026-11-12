import type { OfferHunterSettings } from '../../hunter/OfferHunt';

/** Destino do caçador: 1 grupo por tenant. */
export interface IOfferHunterSettingsRepository {
  get(tenantId: string): Promise<OfferHunterSettings | null>;
  /** Já validados pelo use case (sessão e grupo do tenant). */
  upsert(tenantId: string, sessionId: string, conversationId: string): Promise<OfferHunterSettings>;
}
