import type { OfferDestinationView } from '../entities/OfferDestination';
import type { OfferGeneratorConfig, OfferSessionRef } from '../entities/OfferGeneratorConfig';

export interface SaveOfferGeneratorConfigInput {
  tenantId: string;
  sessionId: string;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  /** Já validados (grupos da sessão e do tenant). */
  conversationIds: string[];
}

export interface IOfferGeneratorConfigRepository {
  /** null = tenant nunca configurou. */
  find(tenantId: string): Promise<OfferGeneratorConfig | null>;
  /** Grupos selecionados (`OfferDestination`), só conversas do tenant. */
  listGroups(tenantId: string): Promise<OfferDestinationView[]>;
  /** Upsert da configuração + troca dos destinos na mesma transação. */
  save(input: SaveOfferGeneratorConfigInput): Promise<void>;
  /** Sessão do tenant não apagada, ou null. */
  findSession(tenantId: string, sessionId: string): Promise<OfferSessionRef | null>;
  /** Subconjunto de `ids` que são conversas de GRUPO desta sessão e deste tenant. */
  filterSessionGroups(tenantId: string, sessionId: string, ids: string[]): Promise<string[]>;
}
