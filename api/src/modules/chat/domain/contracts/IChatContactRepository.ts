import type { ChatContact } from '../entities/ChatContact';

export interface ChatContactCreateData {
  tenantId: string;
  name: string;
  phone: string;
  /** LID (dígitos) visto com este telefone. Ausente/null nunca apaga um `lid` já gravado. */
  lid?: string | null;
  avatarUrl?: string | null;
  notes?: string | null;
}

export interface IChatContactRepository {
  findById(id: string, tenantId: string): Promise<ChatContact | null>;
  /**
   * Carrega vários contatos de uma vez, para evitar uma consulta por item ao
   * montar listas. Ids inexistentes são simplesmente omitidos do resultado.
   */
  findByIds(ids: string[], tenantId: string): Promise<ChatContact[]>;
  findByPhone(phone: string, tenantId: string): Promise<ChatContact | null>;
  /** Carrega vários contatos por telefone numa única consulta. */
  findByPhones(phones: string[], tenantId: string): Promise<ChatContact[]>;
  /** Contato cujo par LID↔telefone já foi persistido (resolução de menção/citação sem a engine). */
  findByLid(tenantId: string, lid: string): Promise<ChatContact | null>;
  /** Busca por nome ou telefone parcial, para sugerir contatos ao usuário. */
  search(term: string, tenantId: string, limit: number): Promise<ChatContact[]>;
  findOrCreate(data: ChatContactCreateData): Promise<ChatContact>;
  upsert(data: ChatContactCreateData): Promise<ChatContact>;
  /** Atualiza APENAS o avatarUrl do contato sem tocar em nome ou outros campos. */
  updateAvatarUrlByPhone(phone: string, tenantId: string, avatarUrl: string): Promise<void>;
}
