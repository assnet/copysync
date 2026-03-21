import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import { logger } from '../../../../shared/logger/logger';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import { chatWsPublisher } from '../ws/ChatWebSocketPublisher';
import type { InternalMessagingEvent } from '../../../../shared/events/InternalMessagingEvent';

type GroupAvatarUpdatedEvent = Extract<InternalMessagingEvent, { type: 'GROUP_AVATAR_UPDATED' }>;

/**
 * Listens to GROUP_AVATAR_UPDATED events (emitidos pelo adapter Baileys) e:
 * 1. Persiste o groupAvatarUrl em todas as conversas do grupo via updateGroupAvatarUrlByGroupJid
 * 2. Notifica o frontend em tempo real via chat.contact.updated (phone = groupJid)
 *    — reutiliza o handler existente no ChatPage que já atualiza contact.avatarUrl
 *
 * Deve ser registrado uma vez na inicialização do servidor.
 */
export function registerChatGroupAvatarListener(
  conversationRepo: IChatConversationRepository,
): void {
  internalEventBus.on<GroupAvatarUpdatedEvent>('GROUP_AVATAR_UPDATED', async (payload) => {
    try {
      await conversationRepo.updateGroupAvatarUrlByGroupJid(
        payload.groupJid,
        payload.tenantId,
        payload.avatarUrl,
      );

      chatWsPublisher.publish(payload.tenantId, {
        event: 'chat.contact.updated',
        data: {
          tenantId: payload.tenantId,
          phone: payload.groupJid, // grupos têm contact.phone = groupJid no DTO sintético
          avatarUrl: payload.avatarUrl,
        },
      });
    } catch (err) {
      logger.warn({ err, groupJid: payload.groupJid }, 'Failed to update group avatar via listener');
    }
  });

  logger.info('ChatGroupAvatarListener registered');
}
