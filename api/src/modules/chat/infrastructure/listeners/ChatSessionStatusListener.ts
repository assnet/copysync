import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import type { InternalMessagingEvent } from '../../../../shared/events/InternalMessagingEvent';
import { chatWsPublisher } from '../ws/ChatWebSocketPublisher';
import { logger } from '../../../../shared/logger/logger';

type SessionConnectedEvent = Extract<InternalMessagingEvent, { type: 'SESSION_CONNECTED' }>;
type SessionDisconnectedEvent = Extract<InternalMessagingEvent, { type: 'SESSION_DISCONNECTED' }>;
type SessionLoggedOutEvent = Extract<InternalMessagingEvent, { type: 'SESSION_LOGGED_OUT' }>;

export function registerChatSessionStatusListener(): void {
  internalEventBus.on<SessionConnectedEvent>('SESSION_CONNECTED', (payload) => {
    chatWsPublisher.publish(payload.tenantId, {
      event: 'chat.session.updated',
      data: {
        tenantId: payload.tenantId,
        sessionId: payload.sessionId,
        status: 'CONNECTED',
      },
    });
  });

  internalEventBus.on<SessionDisconnectedEvent>('SESSION_DISCONNECTED', (payload) => {
    chatWsPublisher.publish(payload.tenantId, {
      event: 'chat.session.updated',
      data: {
        tenantId: payload.tenantId,
        sessionId: payload.sessionId,
        status: 'DISCONNECTED',
      },
    });
  });

  internalEventBus.on<SessionLoggedOutEvent>('SESSION_LOGGED_OUT', (payload) => {
    chatWsPublisher.publish(payload.tenantId, {
      event: 'chat.session.updated',
      data: {
        tenantId: payload.tenantId,
        sessionId: payload.sessionId,
        status: 'LOGGED_OUT',
      },
    });
  });

  logger.info('ChatSessionStatusListener registered');
}