import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import { logger } from '../../../../shared/logger/logger';
import { ChatMessageStatus } from '../../domain/enums/ChatMessageEnums';
import { chatWsPublisher } from '../ws/ChatWebSocketPublisher';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { InternalMessagingEvent } from '../../../../shared/events/InternalMessagingEvent';

type MessageDeliveredEvent = Extract<InternalMessagingEvent, { type: 'MESSAGE_DELIVERED' }>;
type MessageReadEvent      = Extract<InternalMessagingEvent, { type: 'MESSAGE_READ' }>;

/**
 * Subscribes to MESSAGE_DELIVERED and MESSAGE_READ events on the internal event bus.
 * For each event:
 *  1. Finds the message by its external WA ID
 *  2. Updates the status in the DB
 *  3. Publishes chat.message.status.updated via WebSocket so the UI shows the correct tick
 *
 * Must be called once during application startup.
 */
export function registerChatMessageStatusListener(
  messageRepo: IChatMessageRepository,
): void {
  async function handleStatusUpdate(
    externalMessageId: string,
    tenantId: string,
    status: ChatMessageStatus,
  ): Promise<void> {
    try {
      const updated = await messageRepo.updateStatusByExternalId(
        externalMessageId,
        tenantId,
        status,
      );
      if (!updated) return; // message not found — likely a message from another session

      chatWsPublisher.publish(tenantId, {
        event: 'chat.message.status.updated',
        data: {
          tenantId,
          conversationId: updated.conversationId,
          messageId: updated.id,
          status: updated.status ?? status,
        },
      });
    } catch (err) {
      logger.warn({ err, externalMessageId, tenantId }, 'Failed to update message status');
    }
  }

  internalEventBus.on<MessageDeliveredEvent>('MESSAGE_DELIVERED', (payload) => {
    handleStatusUpdate(payload.messageId, payload.tenantId, ChatMessageStatus.DELIVERED);
  });

  internalEventBus.on<MessageReadEvent>('MESSAGE_READ', (payload) => {
    handleStatusUpdate(payload.messageId, payload.tenantId, ChatMessageStatus.READ);
  });

  logger.info('ChatMessageStatusListener registered');
}
