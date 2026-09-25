/**
 * Lista de conversa do painel — entrada do catálogo por tenant.
 *
 * O nome é o vínculo: a associação com a conversa fica em `ChatConversation.tags`.
 * O catálogo existe para a lista sobreviver sem conversa e para renomear/excluir
 * refletir em cascata nas conversas.
 */
export interface ChatList {
  id: string;
  tenantId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lista como o painel a vê. `id: null` quando o nome só existe em `tags` de conversas
 * antigas (dado anterior ao catálogo) — a próxima escrita pelo catálogo cria a entrada.
 */
export interface ChatListSummary {
  id: string | null;
  name: string;
  conversationCount: number;
}
