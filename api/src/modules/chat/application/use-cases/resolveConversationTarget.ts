import type { ChatConversation } from '../../domain/entities/ChatConversation';
import type { ChatContact } from '../../domain/entities/ChatContact';
import type { ChatMessage } from '../../domain/entities/ChatMessage';
import type { QuotedMessageRef } from '../../../messaging/domain/contracts/IMessagingEngine';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { ChatMessageDirection } from '../../domain/enums/ChatMessageEnums';

/** Destino de envio de uma conversa, já resolvido para a engine. */
export interface ConversationTarget {
  /** JID de destino: `<groupJid>@g.us` em grupo, telefone do contato no individual */
  recipientPhone: string;
  /** Telefone do contato; `null` em grupo */
  contactPhone: string | null;
  isGroup: boolean;
}

/**
 * Resolve o destino da conversa. Função pura: o contato é buscado por quem chama, e só
 * em conversa individual — em grupo não há contato. Não decide nada sobre engine/sessão.
 */
export function resolveConversationTarget(
  conv: Pick<ChatConversation, 'id' | 'isGroup' | 'groupJid' | 'contactId'>,
  contact: Pick<ChatContact, 'phone'> | null,
): ConversationTarget {
  const isGroup = conv.isGroup ?? false;

  if (isGroup) {
    if (!conv.groupJid) throw new NotFoundError('GroupJid', conv.id);
    return { recipientPhone: `${conv.groupJid}@g.us`, contactPhone: null, isGroup };
  }

  if (!contact) throw new NotFoundError('Contact', conv.contactId ?? '');
  return { recipientPhone: contact.phone, contactPhone: contact.phone, isGroup };
}

/**
 * Monta a referência de uma mensagem já existente no WhatsApp (citação, e reação a seguir).
 * `null` quando a mensagem nunca chegou à engine (sem `externalMessageId`).
 */
export function buildEngineMessageRef(
  target: ConversationTarget,
  message: Pick<ChatMessage, 'externalMessageId' | 'direction' | 'content' | 'type'>,
): QuotedMessageRef | null {
  if (!message.externalMessageId) return null;
  return {
    externalId: message.externalMessageId,
    remoteJid:  target.isGroup ? target.recipientPhone : (target.contactPhone ?? target.recipientPhone),
    fromMe:     message.direction === ChatMessageDirection.OUTBOUND,
    body:       message.content,
    type:       message.type,
  };
}
