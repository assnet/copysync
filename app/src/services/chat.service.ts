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
} from '@/types/chat.api.types';

export const chatService = {
  async listConversations(
    params?: ListConversationsParams,
  ): Promise<ChatConversationApiDto[]> {
    const res = await apiClient.get<{ success: true; data: ChatConversationApiDto[] }>(
      '/chat/conversations',
      { params },
    );
    return res.data.data;
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
