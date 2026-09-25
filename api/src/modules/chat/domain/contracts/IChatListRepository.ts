import type { ChatList, ChatListSummary } from '../entities/ChatList';

/**
 * Catálogo de listas do tenant. Toda operação recebe `tenantId`.
 *
 * `rename*`/`delete*` são a única porta para mexer no nome de uma lista: além do
 * catálogo, substituem/removem o nome em `tags` de todas as conversas do tenant, na
 * mesma transação. Comparações de nome não diferenciam maiúsculas.
 */
export interface IChatListRepository {
  /** Catálogo ∪ nomes distintos em `tags`, com contagem, em ordem alfabética (case-insensitive). */
  listWithCounts(tenantId: string): Promise<ChatListSummary[]>;
  findById(tenantId: string, id: string): Promise<ChatList | null>;
  findByName(tenantId: string, name: string): Promise<ChatList | null>;
  /** Conversas do tenant que carregam o nome em `tags`. */
  countConversations(tenantId: string, name: string): Promise<number>;
  create(tenantId: string, name: string): Promise<ChatList>;
  /** Devolve a existente (case-insensitive) ou cria. Seguro sob concorrência. */
  ensure(tenantId: string, name: string): Promise<ChatList>;
  /** Renomeia no catálogo e em cascata em `tags`. */
  rename(tenantId: string, id: string, newName: string): Promise<ChatList>;
  /** Idem para nome sem entrada no catálogo: cria a entrada com o nome novo. */
  renameByName(tenantId: string, oldName: string, newName: string): Promise<ChatList>;
  /** Remove do catálogo e em cascata de `tags`. */
  delete(tenantId: string, id: string): Promise<void>;
  /** Idem por nome (remove a entrada do catálogo se houver). */
  deleteByName(tenantId: string, name: string): Promise<void>;
}
