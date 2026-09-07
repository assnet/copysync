import { apiClient } from './apiClient';
import { resolveMediaUrl } from '@/utils/resolveMediaUrl';
import type {
  ChatConversationApiDto,
  ChatMessageApiDto,
  ChatContactApiDto,
  ListConversationsParams,
  ListMessagesParams,
  UpdateConversationRequest,
  GroupParticipantApiDto,
  ContactSuggestionApiDto,
} from '@/types/chat.api.types';

export const chatService = {
  async listConversations(
    params?: ListConversationsParams,
  ): Promise<{ conversations: ChatConversationApiDto[]; archivedCount: number }> {
    const res = await apiClient.get<{
      success: true;
      data: { conversations: ChatConversationApiDto[]; archivedCount: number } | ChatConversationApiDto[];
    }>('/chat/conversations', { params });

    // Tolera a resposta antiga (array puro) durante a janela entre o deploy do
    // painel e o da API, quando os dois ainda não estão na mesma versão.
    const data = res.data.data;
    return Array.isArray(data)
      ? { conversations: data, archivedCount: 0 }
      : data;
  },

  async getConversation(id: string): Promise<ChatConversationApiDto> {
    const res = await apiClient.get<{ success: true; data: ChatConversationApiDto }>(
      `/chat/conversations/${id}`,
    );
    return res.data.data;
  },

  async updateConversation(
    id: string,
    data: UpdateConversationRequest,
  ): Promise<ChatConversationApiDto> {
    const res = await apiClient.patch<{ success: true; data: ChatConversationApiDto }>(
      `/chat/conversations/${id}`,
      data,
    );
    return res.data.data;
  },

  async listMessages(
    conversationId: string,
    params?: ListMessagesParams,
  ): Promise<ChatMessageApiDto[]> {
    const res = await apiClient.get<{ success: true; data: ChatMessageApiDto[] }>(
      `/chat/conversations/${conversationId}/messages`,
      { params },
    );
    return res.data.data;
  },

  async sendMessage(
    conversationId: string,
    content: string,
    quotedMessageId?: string | null,
  ): Promise<ChatMessageApiDto> {
    const res = await apiClient.post<{ success: true; data: ChatMessageApiDto }>(
      `/chat/conversations/${conversationId}/messages`,
      { content, ...(quotedMessageId ? { quotedMessageId } : {}) },
    );
    return res.data.data;
  },

  async getContact(contactId: string): Promise<ChatContactApiDto> {
    const res = await apiClient.get<{ success: true; data: ChatContactApiDto }>(
      `/chat/contacts/${contactId}`,
    );
    return res.data.data;
  },

  async markAsRead(conversationId: string): Promise<void> {
    await apiClient.post(`/chat/conversations/${conversationId}/read`);
  },

  async subscribePresence(conversationId: string): Promise<void> {
    await apiClient.post(`/chat/conversations/${conversationId}/presence`);
  },

  async updateConversationState(
    conversationId: string,
    change: {
      archived?: boolean; pinned?: boolean; muteMs?: number | null;
      favorite?: boolean; unread?: boolean; lists?: string[];
    },
  ): Promise<{ syncedToWhatsApp: boolean }> {
    const res = await apiClient.patch<{ success: true; data: { syncedToWhatsApp: boolean } }>(
      `/chat/conversations/${conversationId}/state`,
      change,
    );
    return res.data.data;
  },

  async suggestContacts(term: string, sessionId?: string): Promise<ContactSuggestionApiDto[]> {
    const res = await apiClient.get<{ success: true; data: { suggestions: ContactSuggestionApiDto[] } }>(
      '/chat/contacts/suggest',
      { params: { q: term, ...(sessionId ? { sessionId } : {}) } },
    );
    return res.data.data.suggestions.map((s) => ({ ...s, avatarUrl: resolveMediaUrl(s.avatarUrl) }));
  },

  async startConversation(input: { sessionId: string; phone: string; name?: string }): Promise<string> {
    const res = await apiClient.post<{ success: true; data: { conversationId: string; created: boolean } }>(
      '/chat/conversations',
      input,
    );
    return res.data.data.conversationId;
  },

  async syncAvatars(): Promise<{ updated: number; remaining: number }> {
    const res = await apiClient.post<{ success: true; data: { updated: number; remaining: number } }>(
      '/chat/avatars/sync',
    );
    return res.data.data;
  },

  async listGroupParticipants(conversationId: string): Promise<GroupParticipantApiDto[]> {
    const res = await apiClient.get<{ success: true; data: { participants: GroupParticipantApiDto[]; total: number } }>(
      `/chat/conversations/${conversationId}/participants`,
    );
    // Participantes podem trazer avatar do WhatsApp (absoluto) ou do contato do
    // tenant (relativo à API) — resolver cobre os dois casos.
    return res.data.data.participants.map((p) => ({
      ...p,
      avatarUrl: resolveMediaUrl(p.avatarUrl),
    }));
  },
};
