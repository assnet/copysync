import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import { logger } from '../../../../shared/logger/logger';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import { chatWsPublisher } from '../ws/ChatWebSocketPublisher';
import type { InternalMessagingEvent } from '../../../../shared/events/InternalMessagingEvent';

type ChatArchiveUpdatedEvent = Extract<InternalMessagingEvent, { type: 'CHAT_ARCHIVE_UPDATED' }>;

/**
 * Espelha no painel o arquivamento feito no WhatsApp.
 *
 * O estado chega pelo adapter (chats.upsert na sincronização inicial, chats.update
 * quando muda em qualquer aparelho) e aqui é persistido e anunciado ao painel.
 *
 * Conversa ainda não conhecida é ignorada em silêncio: o WhatsApp envia o estado de
 * todos os chats do aparelho, e a maioria não tem conversa correspondente aqui.
 */
export function registerChatArchiveListener(
  conversationRepo: IChatConversationRepository,
): void {
  internalEventBus.on<ChatArchiveUpdatedEvent>('CHAT_ARCHIVE_UPDATED', async (payload) => {
    try {
      const changed = await conversationRepo.setArchivedByChat({
        tenantId: payload.tenantId,
        sessionId: payload.sessionId,
        isGroup: payload.isGroup,
        chatId: payload.chatId,
        archived: payload.archived,
      });

      if (changed === 0) return;

      chatWsPublisher.publish(payload.tenantId, {
        event: 'chat.archive.updated',
        data: {
          tenantId: payload.tenantId,
          chatId: payload.chatId,
          isGroup: payload.isGroup,
          archived: payload.archived,
        },
      });
    } catch (err) {
      logger.warn({ err, chatId: payload.chatId }, 'Failed to apply chat archive state');
    }
  });

  logger.info('ChatArchiveListener registered');
}
