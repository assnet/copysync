import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import { ChatMessageDirection, ChatMessageType } from '../../domain/enums/ChatMessageEnums';

export interface IngestIncomingMessageInput {
  tenantId: string;
  sessionId: string;
  /** Phone number of the sender (e.g. "5511999887766") */
  from: string;
  /** Contact display name from WhatsApp push name, if available */
  fromName?: string;
  body: string;
  /** Engine-level message ID for deduplication */
  externalMessageId?: string;
}

/**
 * Ingests an incoming WhatsApp message into the chat module.
 *
 * Steps:
 *  1. Find or create the ChatContact by phone
 *  2. Find an active (non-CLOSED) conversation for contact+session, or create one
 *  3. Persist the ChatMessage
 *  4. Update conversation last-message preview, timestamp, and unread counter
 */
export class IngestIncomingMessageUseCase {
  constructor(
    private readonly contactRepo: IChatContactRepository,
    private readonly conversationRepo: IChatConversationRepository,
    private readonly messageRepo: IChatMessageRepository,
  ) {}

  async execute(input: IngestIncomingMessageInput): Promise<void> {
    const { tenantId, sessionId, from, fromName, body, externalMessageId } = input;

    // 1 — Find or create contact
    const contact = await this.contactRepo.findOrCreate({
      tenantId,
      phone: from,
      name: fromName ?? from,
    });

    // 2 — Find active conversation or create a new one
    let conversation = await this.conversationRepo.findActiveByContactAndSession(
      contact.id,
      sessionId,
      tenantId,
    );

    if (!conversation) {
      conversation = await this.conversationRepo.create({
        tenantId,
        sessionId,
        contactId: contact.id,
        channel: 'whatsapp',
      });
    }

    // 3 — Persist the message
    await this.messageRepo.create({
      tenantId,
      conversationId: conversation.id,
      direction: ChatMessageDirection.INBOUND,
      type: ChatMessageType.TEXT,
      content: body,
      externalMessageId: externalMessageId ?? null,
    });

    // 4 — Update conversation metadata
    const preview = body.length > 100 ? body.slice(0, 97) + '…' : body;
    await this.conversationRepo.updateLastMessage(conversation.id, tenantId, {
      lastMessagePreview: preview,
      lastMessageAt: new Date(),
    });
    await this.conversationRepo.incrementUnread(conversation.id, tenantId);
  }
}
