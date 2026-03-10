import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import { logger } from '../../../../shared/logger/logger';
import { IngestIncomingMessageUseCase } from '../../application/use-cases/IngestIncomingMessageUseCase';
import type { InternalMessagingEvent } from '../../../../shared/events/InternalMessagingEvent';

type MessageReceivedEvent = Extract<InternalMessagingEvent, { type: 'MESSAGE_RECEIVED' }>;

/**
 * Subscribes to MESSAGE_RECEIVED on the internal event bus and
 * delegates to IngestIncomingMessageUseCase.
 *
 * Must be called once during application startup, after repositories are ready.
 */
export function registerChatIncomingMessageListener(
  ingestUseCase: IngestIncomingMessageUseCase,
): void {
  internalEventBus.on<MessageReceivedEvent>('MESSAGE_RECEIVED', async (payload) => {
    try {
      await ingestUseCase.execute({
        tenantId: payload.tenantId,
        sessionId: payload.sessionId,
        from: payload.from,
        fromName: payload.fromName,
        body: payload.body,
        externalMessageId: payload.externalMessageId,
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
