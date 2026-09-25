import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import { logger } from '../../../../shared/logger/logger';
import { chatWsPublisher } from '../ws/ChatWebSocketPublisher';
import type { IngestMessageReactionUseCase } from '../../application/use-cases/IngestMessageReactionUseCase';
import type { InternalMessagingEvent } from '../../../../shared/events/InternalMessagingEvent';

type MessageReactionUpdatedEvent = Extract<InternalMessagingEvent, { type: 'MESSAGE_REACTION_UPDATED' }>;

/**
 * Consome MESSAGE_REACTION_UPDATED, grava pela ingestão e publica o agregado no WebSocket.
 *
 * Só publica quando a ingestão devolve resultado: `null` cobre mensagem desconhecida, evento
 * mais antigo que o gravado e eco sem mudança visível — é o que mantém um evento WS por gesto,
 * mesmo quando o eco do painel chega antes da gravação do PUT.
 *
 * Nunca publica chat.conversation.updated nem chat.unread.updated: reação não é mensagem.
 * Deve ser registrado uma vez no startup.
 */
export function registerChatMessageReactionListener(
  ingestReaction: IngestMessageReactionUseCase,
): void {
  internalEventBus.on<MessageReactionUpdatedEvent>('MESSAGE_REACTION_UPDATED', async (payload) => {
    try {
      const result = await ingestReaction.execute({
        tenantId:                payload.tenantId,
        sessionId:               payload.sessionId,
        targetExternalMessageId: payload.targetExternalMessageId,
        emoji:                   payload.emoji,
        reactorKey:              payload.reactorKey,
        reactorPhone:            payload.reactorPhone,
        reactorName:             payload.reactorName,
        fromMe:                  payload.fromMe,
        isEcho:                  payload.isEcho,
        reactionExternalId:      payload.reactionExternalId,
        reactedAt:               new Date(payload.reactedAt),
      });
      if (!result) return;

      chatWsPublisher.publish(payload.tenantId, {
        event: 'chat.message.reaction.updated',
        data: { tenantId: payload.tenantId, ...result },
      });
    } catch (err) {
      logger.warn(
        { err, tenantId: payload.tenantId, targetId: payload.targetExternalMessageId },
        'Failed to ingest message reaction',
      );
    }
  });

  logger.info('ChatMessageReactionListener registered');
}
