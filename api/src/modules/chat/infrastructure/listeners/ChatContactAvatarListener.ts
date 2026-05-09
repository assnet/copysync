import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import { logger } from '../../../../shared/logger/logger';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import { chatWsPublisher } from '../ws/ChatWebSocketPublisher';
import type { InternalMessagingEvent } from '../../../../shared/events/InternalMessagingEvent';

type ContactAvatarUpdatedEvent = Extract<InternalMessagingEvent, { type: 'CONTACT_AVATAR_UPDATED' }>;

/**
 * Listens to CONTACT_AVATAR_UPDATED events (emitidos pelo adapter Baileys) e:
 * 1. Persiste o avatarUrl no DB via updateAvatarUrlByPhone (não toca no nome)
 * 2. Notifica o frontend em tempo real via WebSocket (chat.contact.updated)
 *
 * Deve ser registrado uma vez na inicialização do servidor.
 */
export function registerChatContactAvatarListener(
  contactRepo: IChatContactRepository,
): void {
  internalEventBus.on<ContactAvatarUpdatedEvent>('CONTACT_AVATAR_UPDATED', async (payload) => {
    try {
      await contactRepo.updateAvatarUrlByPhone(payload.phone, payload.tenantId, payload.avatarUrl);

      chatWsPublisher.publish(payload.tenantId, {
        event: 'chat.contact.updated',
        data: {
          tenantId: payload.tenantId,
          phone: payload.phone,
          avatarUrl: payload.avatarUrl,
        },
      });
    } catch (err) {
      logger.warn({ err, phone: payload.phone }, 'Failed to update contact avatar via listener');
    }
  });

  logger.info('ChatContactAvatarListener registered');
}
