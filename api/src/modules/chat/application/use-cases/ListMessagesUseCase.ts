import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import type { ChatMessageDirection, ChatMessageStatus, ChatMessageType } from '../../domain/enums/ChatMessageEnums';

export interface ListMessagesInput {
  conversationId: string;
  tenantId: string;
  limit?: number;
  before?: string;
}

export interface QuotedMessageSummary {
  id: string;
  type: ChatMessageType;
  content: string | null;
  mediaUrl: string | null;
  direction: ChatMessageDirection;
  isDeleted: boolean;
}

export interface ChatMessageDto {
  id: string;
  conversationId: string;
  tenantId: string;
  direction: ChatMessageDirection;
  type: ChatMessageType;
  content: string | null;
  mediaUrl: string | null;
  mimeType: string | null;
  fileName: string | null;
  durationSeconds: number | null;
  externalMessageId: string | null;
  status: ChatMessageStatus | null;
  isDeleted: boolean;
  quotedMessageId: string | null;
  quotedMessage?: QuotedMessageSummary | null;
  sentAt: string | null;
  createdAt: string;
  fromParticipant: string | null;
  fromParticipantName: string | null;
  /** Foto do remetente em mensagens de grupo, quando o contato é conhecido. */
  fromParticipantAvatarUrl: string | null;
}

export class ListMessagesUseCase {
  constructor(
    private readonly messageRepo: IChatMessageRepository,
    private readonly conversationRepo: IChatConversationRepository,
    private readonly contactRepo: IChatContactRepository,
  ) {}

  async execute(input: ListMessagesInput): Promise<ChatMessageDto[]> {
    const conv = await this.conversationRepo.findById(input.conversationId, input.tenantId);
    if (!conv) throw new NotFoundError('Conversation', input.conversationId);

    const messages = await this.messageRepo.findMany({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      limit: input.limit ?? 50,
      before: input.before,
    });

    // Avatares dos remetentes de grupo, em consulta única para toda a página.
    const participantPhones = messages
      .map((m) => m.fromParticipant)
      .filter((p): p is string => !!p);
    const avatarByPhone = new Map(
      (await this.contactRepo.findByPhones(participantPhones, input.tenantId))
        .map((c) => [c.phone, c.avatarUrl]),
    );

    return messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      tenantId: m.tenantId,
      direction: m.direction,
      type: m.type,
      content: m.content,
      mediaUrl: m.mediaUrl,
      mimeType: m.mimeType,
      fileName: m.fileName,
      durationSeconds: m.durationSeconds,
      externalMessageId: m.externalMessageId,
      status: m.status,
      isDeleted: m.isDeleted,
      quotedMessageId: m.quotedMessageId,
      sentAt: m.sentAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      fromParticipant: m.fromParticipant,
      fromParticipantName: m.fromParticipantName,
      fromParticipantAvatarUrl: m.fromParticipant
        ? (avatarByPhone.get(m.fromParticipant) ?? null)
        : null,
    }));
  }
}
