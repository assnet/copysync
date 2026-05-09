import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { ChatMessage } from '../../domain/entities/ChatMessage';
import { ChatMessageDirection, ChatMessageType } from '../../domain/enums/ChatMessageEnums';

export interface IngestIncomingMessageInput {
  tenantId: string;
  sessionId: string;
  /** Phone number of the contact involved (e.g. "5511999887766") */
  from: string;
  /** Contact display name from WhatsApp push name, if available */
  fromName?: string;
  body: string | null;
  /** Detected message type */
  msgType?: ChatMessageType;
  mediaUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  durationSeconds?: number | null;
  isDeleted?: boolean;
  quotedMessageId?: string | null;
  /** Engine-level message ID for deduplication */
  externalMessageId?: string;
  /** true = sent by us from the phone → OUTBOUND; false/undefined = received → INBOUND */
  fromMe?: boolean;
  /** true = mensagem de grupo */
  isGroup?: boolean;
  /** JID do grupo (sem @g.us), quando isGroup=true */
  groupJid?: string;
  /** Nome do grupo, quando isGroup=true */
  groupName?: string;
  /** Telefone do participante que enviou (sem @s.whatsapp.net), em grupos */
  participant?: string;
  /** Nome do participante que enviou, em grupos */
  participantName?: string;
}

export interface IngestIncomingMessageResult {
  conversationId: string;
  message: ChatMessage;
  /** True when the conversation was just created by this ingest */
  isNewConversation: boolean;
  unreadCount: number;
}

/**
 * Ingests an incoming WhatsApp message into the chat module.
 *
 * Steps:
 *  1. Find or create the ChatContact by phone
 *  2. Find an active (non-CLOSED) conversation for contact+session, or create one
 *  3. Deduplicate by externalMessageId
 *  4. Persist the ChatMessage
 *  5. Update conversation last-message preview, timestamp, and unread counter
 *
 * Returns null when the message was already processed (duplicate).
 */
export class IngestIncomingMessageUseCase {
  constructor(
    private readonly contactRepo: IChatContactRepository,
    private readonly conversationRepo: IChatConversationRepository,
    private readonly messageRepo: IChatMessageRepository,
  ) {}

  async execute(input: IngestIncomingMessageInput): Promise<IngestIncomingMessageResult | null> {
    const { tenantId, sessionId, from, fromName, body, externalMessageId, fromMe } = input;

    // 2 — Find active conversation or create a new one
    let isNewConversation = false;
    let conversation;

    if (input.isGroup && input.groupJid) {
      // Grupo: conversa identificada pelo groupJid, sem contato
      conversation = await this.conversationRepo.findActiveByGroupAndSession(
        input.groupJid,
        sessionId,
        tenantId,
      );
      if (!conversation) {
        conversation = await this.conversationRepo.create({
          tenantId,
          sessionId,
          isGroup: true,
          groupJid: input.groupJid,
          groupName: input.groupName,
          channel: 'whatsapp',
        });
        isNewConversation = true;
      }
    } else {
      // Individual: conversa identificada pelo contato
      // 1 — Find or create contact
      // Quando fromMe=true, pushName é o nome do próprio usuário — não do contato
      const contact = await this.contactRepo.findOrCreate({
        tenantId,
        phone: from,
        name: (!fromMe && fromName) ? fromName : from,
      });

      conversation = await this.conversationRepo.findActiveByContactAndSession(
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
        isNewConversation = true;
      }
    }

    // 3 — Deduplicate by engine-level message ID before persisting
    if (externalMessageId) {
      const existing = await this.messageRepo.findByExternalId(externalMessageId, tenantId);
      if (existing) return null;
    }

    // 4 — Persist the message
    const direction = fromMe ? ChatMessageDirection.OUTBOUND : ChatMessageDirection.INBOUND;
    const type = input.msgType ?? ChatMessageType.TEXT;
    const message = await this.messageRepo.create({
      tenantId,
      conversationId: conversation.id,
      direction,
      type,
      content: body,
      mediaUrl: input.mediaUrl ?? null,
      mimeType: input.mimeType ?? null,
      fileName: input.fileName ?? null,
      durationSeconds: input.durationSeconds ?? null,
      isDeleted: input.isDeleted ?? false,
      quotedMessageId: input.quotedMessageId ?? null,
      externalMessageId: externalMessageId ?? null,
      fromParticipant: input.participant ?? null,
      fromParticipantName: input.participantName ?? null,
    });

    // 5 — Update conversation metadata
    const preview = buildPreview(type, body);
    await this.conversationRepo.updateLastMessage(conversation.id, tenantId, {
      lastMessagePreview: preview,
      lastMessageAt: new Date(),
    });
    // Mensagens enviadas por nós não incrementam o contador de não-lidas
    if (!fromMe) {
      await this.conversationRepo.incrementUnread(conversation.id, tenantId);
    }

    const updated = await this.conversationRepo.findById(conversation.id, tenantId);
    const unreadCount = updated?.unreadCount ?? (fromMe ? conversation.unreadCount : conversation.unreadCount + 1);

    return { conversationId: conversation.id, message, isNewConversation, unreadCount };
  }
}

function buildPreview(type: ChatMessageType, body: string | null): string {
  if (body) return body.length > 100 ? body.slice(0, 97) + '…' : body;
  const labels: Partial<Record<ChatMessageType, string>> = {
    [ChatMessageType.IMAGE]:    '📷 Imagem',
    [ChatMessageType.AUDIO]:    '🎵 Áudio',
    [ChatMessageType.VIDEO]:    '🎥 Vídeo',
    [ChatMessageType.DOCUMENT]: '📄 Documento',
    [ChatMessageType.STICKER]:  '😊 Sticker',
    [ChatMessageType.LOCATION]: '📍 Localização',
    [ChatMessageType.VCARD]:    '👤 Contato',
    [ChatMessageType.CALL_LOG]: '📞 Chamada',
  };
  return labels[type] ?? '📎 Mídia';
}
