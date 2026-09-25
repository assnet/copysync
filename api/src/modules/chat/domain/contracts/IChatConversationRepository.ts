import type { ChatConversation } from '../entities/ChatConversation';
import type { ConversationStatus } from '../enums/ConversationStatus';
// RemoteChatState é o contrato de eventos internos (AGENTS.md §12): tipo puro, sem
// Prisma, Fastify ou engine. O domínio pode depender dele sem quebrar a regra da §8.
import type { RemoteChatState } from '../../../../shared/events/InternalMessagingEvent';
import type { AppliedConversationState } from '../services/diffRemoteState';

export interface ListConversationsFilter {
  tenantId: string;
  /** true = só arquivadas, false = só ativas, undefined = todas. */
  archived?: boolean;
  search?: string;
  status?: ConversationStatus;
  sessionId?: string;
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface ConversationUpdateData {
  status?: ConversationStatus;
  assignedUserId?: string | null;
  queueName?: string | null;
  tags?: string[];
  notes?: string | null;
  autoDownloadMedia?: boolean;
}

export interface ConversationLastMessageUpdate {
  lastMessagePreview: string;
  lastMessageAt: Date;
}

export interface ConversationStateUpdate {
  archived?: boolean;
  pinned?: boolean;
  mutedUntil?: Date | null;
  favorite?: boolean;
  manuallyUnread?: boolean;
  tags?: string[];
  unreadCount?: number;
}

export interface ApplyRemoteStateResult {
  conversationId: string;
  /** Vazio quando nada mudou: o chamador não deve publicar nada. */
  changed: AppliedConversationState;
}

export interface CreateConversationData {
  tenantId: string;
  sessionId?: string | null;
  /** null para conversas de grupo */
  contactId?: string | null;
  externalChatId?: string | null;
  channel?: string;
  isGroup?: boolean;
  groupJid?: string | null;
  groupName?: string | null;
  /**
   * Estado que a conversa já nasce tendo — contador de não lidas, arquivamento, fixação
   * e silenciamento. Só o history sync informa: é o retrato do aparelho no momento em
   * que a conversa entra no painel.
   *
   * Sem isso a conversa importada nasceria lida, desarquivada e sem fixação, e nada a
   * corrigiria: o espelhamento só atualiza conversa existente, a reconciliação do
   * contador é monotônica para baixo e arquivamento/fixação só chegam quando mudam.
   * Ver `initialStateFromRemote`.
   */
  unreadCount?: number;
  manuallyUnread?: boolean;
  archived?: boolean;
  pinned?: boolean;
  mutedUntil?: Date | null;
}

export interface IChatConversationRepository {
  findById(id: string, tenantId: string): Promise<ChatConversation | null>;
  findMany(filter: ListConversationsFilter): Promise<ChatConversation[]>;
  /**
   * Returns the most recent non-CLOSED conversation for a given contact+session pair.
   * Used when ingesting incoming messages to continue an existing conversation.
   */
  findActiveByContactAndSession(
    contactId: string,
    sessionId: string,
    tenantId: string,
  ): Promise<ChatConversation | null>;
  /**
   * Returns the most recent non-CLOSED group conversation for a given groupJid+session pair.
   */
  findActiveByGroupAndSession(
    groupJid: string,
    sessionId: string,
    tenantId: string,
  ): Promise<ChatConversation | null>;
  create(data: CreateConversationData): Promise<ChatConversation>;
  update(id: string, tenantId: string, data: ConversationUpdateData): Promise<ChatConversation>;
  updateLastMessage(
    id: string,
    tenantId: string,
    data: ConversationLastMessageUpdate,
  ): Promise<void>;
  incrementUnread(id: string, tenantId: string): Promise<void>;
  resetUnread(id: string, tenantId: string): Promise<void>;
  /** Atualiza apenas groupAvatarUrl de todas as conversações do grupo (sem tocar outros campos). */
  updateGroupAvatarUrlByGroupJid(groupJid: string, tenantId: string, avatarUrl: string): Promise<void>;
  /** Atualiza os estados da conversa (arquivada, fixada, silenciada, etc.). */
  updateState(id: string, tenantId: string, data: ConversationStateUpdate): Promise<ChatConversation>;
  /**
   * Espelha o estado alterado em outro aparelho do mesmo usuário.
   *
   * Devolve null quando não há conversa correspondente (o WhatsApp entrega o estado de
   * todos os chats do aparelho, e a maioria não existe aqui) e `changed` vazio quando o
   * estado recebido é igual ao persistido — é assim que o eco do próprio painel é
   * barrado antes de virar gravação e frame de WebSocket.
   */
  applyRemoteState(input: {
    tenantId: string;
    sessionId: string;
    isGroup: boolean;
    /** groupJid (grupo) ou telefone do contato (individual). */
    chatId: string;
    state: RemoteChatState;
  }): Promise<ApplyRemoteStateResult | null>;
  /** Quantidade de conversas arquivadas do tenant. */
  countArchived(tenantId: string, sessionId?: string): Promise<number>;
  /**
   * Troca `oldName` por `newName` em `tags` de todas as conversas do tenant, sem duplicar
   * quando a conversa já tinha o novo. Chame pelo catálogo de listas (`IChatListRepository`),
   * que faz isso na mesma transação da mudança de nome.
   */
  replaceTag(tenantId: string, oldName: string, newName: string): Promise<number>;
  /** Remove `name` de `tags` de todas as conversas do tenant. Idem: passe pelo catálogo. */
  removeTag(tenantId: string, name: string): Promise<number>;
}
