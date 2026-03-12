import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { ChatMessageDirection, ChatMessageType } from '../../domain/enums/ChatMessageEnums';
import { logger } from '../../../../shared/logger/logger';
import type { ChatMessageDto } from './ListMessagesUseCase';

export interface SendMessageInput {
  conversationId: string;
  tenantId: string;
  content: string;
  quotedMessageId?: string | null;
}

export class SendMessageUseCase {
  constructor(
    private readonly messageRepo: IChatMessageRepository,
    private readonly conversationRepo: IChatConversationRepository,
    private readonly contactRepo: IChatContactRepository,
    private readonly engine: IMessagingEngine | null,
  ) {}

  async execute(input: SendMessageInput): Promise<ChatMessageDto> {
    const conv = await this.conversationRepo.findById(input.conversationId, input.tenantId);
    if (!conv) throw new NotFoundError('Conversation', input.conversationId);

    const contact = await this.contactRepo.findById(conv.contactId, input.tenantId);
    if (!contact) throw new NotFoundError('Contact', conv.contactId);

    // ── Envia via WhatsApp e obtém o messageId externo ────────────────────
    let externalMessageId: string | null = null;

    if (this.engine && conv.sessionId) {
      try {
        const result = await this.engine.sendTextMessage({
          sessionId: conv.sessionId,
          tenantId:  input.tenantId,
          to:        contact.phone,
          body:      input.content,
        });
        externalMessageId = result.messageId;
      } catch (err) {
        logger.error({ err, conversationId: input.conversationId }, 'Falha ao enviar mensagem pela engine');
        throw err;
      }
    } else {
      logger.warn(
        { conversationId: input.conversationId, hasEngine: !!this.engine, sessionId: conv.sessionId },
        'Engine indisponível ou sessão sem sessionId — mensagem salva sem envio real',
      );
    }

    // ── Persiste com o externalMessageId já resolvido ─────────────────────
    const message = await this.messageRepo.create({
      tenantId:          input.tenantId,
      conversationId:    input.conversationId,
      direction:         ChatMessageDirection.OUTBOUND,
      type:              ChatMessageType.TEXT,
      content:           input.content,
      quotedMessageId:   input.quotedMessageId ?? null,
      externalMessageId,
    });

    // Atualiza preview da última mensagem na conversa
    await this.conversationRepo.updateLastMessage(
      input.conversationId,
      input.tenantId,
      {
        lastMessagePreview: input.content,
        lastMessageAt: message.createdAt,
      },
    );

    return {
      id:                message.id,
      conversationId:    message.conversationId,
      tenantId:          message.tenantId,
      direction:         message.direction,
      type:              message.type,
      content:           message.content,
      mediaUrl:          message.mediaUrl,
      mimeType:          message.mimeType,
      fileName:          message.fileName,
      durationSeconds:   message.durationSeconds,
      externalMessageId: message.externalMessageId,
      status:            message.status,
      isDeleted:         message.isDeleted,
      quotedMessageId:   message.quotedMessageId,
      sentAt:            message.sentAt?.toISOString() ?? null,
      createdAt:         message.createdAt.toISOString(),
    };
  }
}
