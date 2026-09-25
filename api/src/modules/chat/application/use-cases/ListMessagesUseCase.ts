import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IChatMessageReactionRepository } from '../../domain/contracts/IChatMessageReactionRepository';
import type { ChatMessageReaction } from '../../domain/entities/ChatMessageReaction';
import { aggregateReactions, type ReactionSummary } from '../../domain/services/aggregateReactions';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import type { ChatMessageDirection, ChatMessageStatus, ChatMessageType } from '../../domain/enums/ChatMessageEnums';

export interface ListMessagesInput {
  conversationId: string;
  tenantId: string;
  limit?: number;
  before?: string;
  /** Busca textual dentro da conversa. */
  search?: string;
  /** Carrega a janela ao redor desta mensagem, para saltar até ela. */
  around?: string;
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
  /** Revisão do agregado de reações (ISO); `null` quando a mensagem nunca teve reação. */
  reactionsRevision: string | null;
  /** Chips de reação; `[]` quando não há. */
  reactions: ReactionSummary[];
}

export class ListMessagesUseCase {
  constructor(
    private readonly messageRepo: IChatMessageRepository,
    private readonly conversationRepo: IChatConversationRepository,
    private readonly contactRepo: IChatContactRepository,
    private readonly reactionRepo: IChatMessageReactionRepository,
  ) {}

  async execute(input: ListMessagesInput): Promise<ChatMessageDto[]> {
    const conv = await this.conversationRepo.findById(input.conversationId, input.tenantId);
    if (!conv) throw new NotFoundError('Conversation', input.conversationId);

    const messages = input.around
      ? await this.messageRepo.findAround({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          messageId: input.around,
          limit: input.limit ?? 50,
        })
      : await this.messageRepo.findMany({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          limit: input.limit ?? 50,
          before: input.before,
          search: input.search,
          // Numa busca interessa o resultado mais recente primeiro; a leitura normal
          // da conversa continua em ordem cronológica.
          orderDir: input.search ? 'desc' : 'asc',
        });

    // Reações da página inteira numa busca só; os autores entram no mesmo lote de contatos.
    const reactionRows = messages.length
      ? await this.reactionRepo.findByMessageIds(messages.map((m) => m.id), input.tenantId)
      : [];
    const reactionsByMessage = new Map<string, ChatMessageReaction[]>();
    for (const row of reactionRows) {
      const list = reactionsByMessage.get(row.messageId);
      if (list) list.push(row);
      else reactionsByMessage.set(row.messageId, [row]);
    }

    // Remetentes de grupo (avatar) e autores de reação (nome), em consulta única para a página.
    const phones = [
      ...new Set([
        ...messages.map((m) => m.fromParticipant),
        ...reactionRows.map((r) => r.reactorPhone),
      ].filter((p): p is string => !!p)),
    ];
    const contactByPhone = new Map(
      (await this.contactRepo.findByPhones(phones, input.tenantId)).map((c) => [c.phone, c]),
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
        ? (contactByPhone.get(m.fromParticipant)?.avatarUrl ?? null)
        : null,
      ...this.reactionFields(reactionsByMessage.get(m.id), contactByPhone),
    }));
  }

  private reactionFields(
    rows: ChatMessageReaction[] | undefined,
    contactByPhone: ReadonlyMap<string, { name?: string | null }>,
  ): Pick<ChatMessageDto, 'reactionsRevision' | 'reactions'> {
    if (!rows) return { reactionsRevision: null, reactions: [] };
    const { revision, reactions } = aggregateReactions(rows, contactByPhone);
    return { reactionsRevision: revision, reactions };
  }
}
