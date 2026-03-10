import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import { logger } from '../../../../shared/logger/logger';
import { IngestIncomingMessageUseCase } from '../../application/use-cases/IngestIncomingMessageUseCase';
import { chatWsPublisher } from '../ws/ChatWebSocketPublisher';
import type { InternalMessagingEvent } from '../../../../shared/events/InternalMessagingEvent';

type MessageReceivedEvent = Extract<InternalMessagingEvent, { type: 'MESSAGE_RECEIVED' }>;

/**
 * Subscribes to MESSAGE_RECEIVED on the internal event bus and
 * delegates to IngestIncomingMessageUseCase.
 * On success, publishes a chat.message.created event via WebSocket.
 *
 * Must be called once during application startup, after repositories are ready.
 */
export function registerChatIncomingMessageListener(
  ingestUseCase: IngestIncomingMessageUseCase,
): void {
  internalEventBus.on<MessageReceivedEvent>('MESSAGE_RECEIVED', async (payload) => {
    try {
      const result = await ingestUseCase.execute({
        tenantId: payload.tenantId,
        sessionId: payload.sessionId,
        from: payload.from,
        fromName: payload.fromName,
        body: payload.body,
        externalMessageId: payload.externalMessageId,
      });

      if (!result) return; // duplicate — already processed

      chatWsPublisher.publish(payload.tenantId, {
        event: 'chat.message.created',
        data: {
          tenantId: result.message.tenantId,
          conversationId: result.conversationId,
          message: {
            id: result.message.id,
            conversationId: result.message.conversationId,
            direction: result.message.direction,
            type: result.message.type,
            content: result.message.content,
            mediaUrl: result.message.mediaUrl,
            mimeType: result.message.mimeType,
            status: result.message.status,
            sentAt: result.message.sentAt?.toISOString() ?? null,
            createdAt: result.message.createdAt.toISOString(),
          },
          unreadCount: result.unreadCount,
          isNewConversation: result.isNewConversation,
        },
      });

      chatWsPublisher.publish(payload.tenantId, {
        event: 'chat.unread.updated',
        data: {
          tenantId: result.message.tenantId,
          conversationId: result.conversationId,
          unreadCount: result.unreadCount,
        },
      });
    } catch (err) {
      logger.error(
        { err, sessionId: payload.sessionId, from: payload.from },
        'Failed to ingest incoming message',
      );
    }
  });

  logger.info('ChatIncomingMessageListener registered');
}
