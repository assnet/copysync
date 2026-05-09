import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import { chatWsPublisher } from '../ws/ChatWebSocketPublisher';
import type { InternalMessagingEvent } from '../../../../shared/events/InternalMessagingEvent';
import { logger } from '../../../../shared/logger/logger';

type PresenceUpdatedEvent = Extract<InternalMessagingEvent, { type: 'PRESENCE_UPDATED' }>;

/**
 * Subscribes to PRESENCE_UPDATED on the internal event bus and
 * publishes chat.presence.updated via WebSocket.
 *
 * Presence is ephemeral — it is NOT persisted in the database.
 * The WS event is fired directly so the frontend can update in real-time.
 *
 * Must be called once during application startup.
 */
export function registerChatPresenceListener(): void {
  internalEventBus.on<PresenceUpdatedEvent>('PRESENCE_UPDATED', (payload) => {
    chatWsPublisher.publish(payload.tenantId, {
      event: 'chat.presence.updated',
      data: {
        tenantId: payload.tenantId,
        phone: payload.phone,
        presence: payload.presence,
      },
    });
  });

  logger.info('ChatPresenceListener registered');
}
