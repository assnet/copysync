import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import { logger } from '../../../../shared/logger/logger';
import { IngestIncomingMessageUseCase } from '../../application/use-cases/IngestIncomingMessageUseCase';
import { chatWsPublisher } from '../ws/ChatWebSocketPublisher';
import type { InternalMessagingEvent } from '../../../../shared/events/InternalMessagingEvent';

import { ChatMessageType } from '../../domain/enums/ChatMessageEnums';

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
        msgType: payload.msgType ? (payload.msgType as ChatMessageType) : undefined,
        mediaUrl: payload.mediaUrl,
        mimeType: payload.mimeType,
        fileName: payload.fileName,
        durationSeconds: payload.durationSeconds,
        isDeleted: payload.isDeleted,
        quotedMessageId: payload.quotedMessageId,
        externalMessageId: payload.externalMessageId,
        fromMe: payload.fromMe,
        isGroup: payload.isGroup,
        groupJid: payload.groupJid,
        groupName: payload.groupName,
        participant: payload.participant,
        participantName: payload.participantName,
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
            fileName: result.message.fileName,
            durationSeconds: result.message.durationSeconds,
            status: result.message.status,
            isDeleted: result.message.isDeleted,
            quotedMessageId: result.message.quotedMessageId,
            sentAt: result.message.sentAt?.toISOString() ?? null,
            createdAt: result.message.createdAt.toISOString(),
            fromParticipant: result.message.fromParticipant,
            fromParticipantName: result.message.fromParticipantName,
            externalMessageId: result.message.externalMessageId,
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
