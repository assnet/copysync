import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { ChatMessageDirection, ChatMessageType } from '../../domain/enums/ChatMessageEnums';
import type { ChatMessageDto } from './ListMessagesUseCase';

export interface SendMessageInput {
  conversationId: string;
  tenantId: string;
  content: string;
}

export class SendMessageUseCase {
  constructor(
    private readonly messageRepo: IChatMessageRepository,
    private readonly conversationRepo: IChatConversationRepository,
  ) {}

  async execute(input: SendMessageInput): Promise<ChatMessageDto> {
    const conv = await this.conversationRepo.findById(input.conversationId, input.tenantId);
    if (!conv) throw new NotFoundError('Conversation', input.conversationId);

    const message = await this.messageRepo.create({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: ChatMessageDirection.OUTBOUND,
      type: ChatMessageType.TEXT,
      content: input.content,
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
      id: message.id,
      conversationId: message.conversationId,
      tenantId: message.tenantId,
      direction: message.direction,
      type: message.type,
      content: message.content,
      mediaUrl: message.mediaUrl,
      mimeType: message.mimeType,
      fileName: message.fileName,
      durationSeconds: message.durationSeconds,
      externalMessageId: message.externalMessageId,
      status: message.status,
      isDeleted: message.isDeleted,
      quotedMessageId: message.quotedMessageId,
      sentAt: message.sentAt?.toISOString() ?? null,
      createdAt: message.createdAt.toISOString(),
    };
  }
}
