import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import { ChatMessageDirection } from '../../domain/enums/ChatMessageEnums';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { logger } from '../../../../shared/logger/logger';

export interface MarkConversationAsReadInput {
  conversationId: string;
  tenantId: string;
}

/**
 * Marks all messages in a conversation as read:
 *  1. Resets the unread counter in the DB
 *  2. Sends `readMessages` via Baileys so the sender sees the double-blue tick
 *
 * The engine is accepted as optional — if null (session disconnected), only
 * the DB reset is performed.
 */
export class MarkConversationAsReadUseCase {
  constructor(
    private readonly conversationRepo: IChatConversationRepository,
    private readonly contactRepo: IChatContactRepository,
    private readonly messageRepo: IChatMessageRepository,
    private readonly engine: IMessagingEngine | null,
  ) {}

  async execute(input: MarkConversationAsReadInput): Promise<void> {
    const { conversationId, tenantId } = input;

    const conversation = await this.conversationRepo.findById(conversationId, tenantId);
    if (!conversation) throw new NotFoundError('Conversation', conversationId);

    // 1 — Zera contador de não-lidas
    await this.conversationRepo.resetUnread(conversationId, tenantId);

    // 2 — Envia receipts ao WhatsApp (double blue tick)
    if (!this.engine || !conversation.sessionId) return;

    // Para grupos: usa groupJid@g.us; para individuais: usa phone do contato
    let remoteJid: string | undefined;
    if (conversation.isGroup && conversation.groupJid) {
      remoteJid = `${conversation.groupJid}@g.us`;
    } else if (conversation.contactId) {
      const contact = await this.contactRepo.findById(conversation.contactId, tenantId);
      remoteJid = contact?.phone;
    }
    if (!remoteJid) return;

    // Busca as mensagens mais recentes para encontrar a última INBOUND
    // (basta enviar receipt da última — WA marca todas as anteriores como lidas)
    const recentMessages = await this.messageRepo.findMany({
      tenantId,
      conversationId,
      limit: 20,
      orderDir: 'desc',
    });

    const lastInbound = recentMessages.find(
      (m) => m.direction === ChatMessageDirection.INBOUND && m.externalMessageId,
    );

    if (!lastInbound?.externalMessageId) return;

    try {
      await this.engine.markMessagesRead({
        sessionId: conversation.sessionId,
        tenantId,
        remoteJid,
        messageIds: [lastInbound.externalMessageId],
      });
    } catch (err) {
      logger.warn({ err, conversationId }, 'Read receipts failed — continuing');
    }
  }
}
