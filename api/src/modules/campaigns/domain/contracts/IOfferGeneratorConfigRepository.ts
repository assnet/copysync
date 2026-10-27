import type { OfferDestinationView } from '../entities/OfferDestination';
import type { OfferDispatchOrder, OfferGeneratorConfig, OfferSessionRef } from '../entities/OfferGeneratorConfig';

export interface SessionGroupConversation {
  conversationId: string;
  groupJid: string;
  title: string | null;
  avatarUrl: string | null;
}

export interface SaveOfferGeneratorConfigInput {
  tenantId: string;
  /** Na ordem de envio; já validadas (sessões do tenant). */
  sessionIds: string[];
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  dispatchOrder: OfferDispatchOrder;
  /** Já validados (grupos das sessões e do tenant). */
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
  /** Sessões do tenant não apagadas entre `sessionIds`, na ordem de `sessionIds`. */
  findSessions(tenantId: string, sessionIds: string[]): Promise<OfferSessionRef[]>;
  /** Conversas de grupo já existentes desta sessão (não fechadas), para cruzar com o WhatsApp. */
  listSessionGroupConversations(tenantId: string, sessionId: string): Promise<SessionGroupConversation[]>;
  /** Subconjunto de `ids` que são conversas de GRUPO destas sessões e deste tenant. */
  filterSessionGroups(tenantId: string, sessionIds: string[], ids: string[]): Promise<string[]>;
}
