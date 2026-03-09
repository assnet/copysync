import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { ISessionRepository } from '../../../sessions/domain/contracts/ISessionRepository';
import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import type { ConversationListItemDto } from './ListConversationsUseCase';

export interface GetConversationByIdInput {
  conversationId: string;
  tenantId: string;
}

export class GetConversationByIdUseCase {
  constructor(
    private readonly conversationRepo: IChatConversationRepository,
    private readonly contactRepo: IChatContactRepository,
    private readonly sessionRepo: ISessionRepository,
    private readonly userRepo: IUserRepository,
  ) {}

  async execute(input: GetConversationByIdInput): Promise<ConversationListItemDto> {
    const conv = await this.conversationRepo.findById(input.conversationId, input.tenantId);
    if (!conv) throw new NotFoundError('Conversation', input.conversationId);

    const contact = await this.contactRepo.findById(conv.contactId, conv.tenantId);
    if (!contact) throw new NotFoundError('Contact', conv.contactId);

    let session = null;
    if (conv.sessionId) {
      const sess = await this.sessionRepo.findById(conv.sessionId, conv.tenantId);
      if (sess) {
        session = {
          id: sess.id,
          name: sess.name,
          phone: sess.phone,
          status: sess.status,
        };
      }
    }

    let assignedUser = null;
    if (conv.assignedUserId) {
      const user = await this.userRepo.findById(conv.assignedUserId);
      if (user) {
        assignedUser = { id: user.id, name: user.name };
      }
    }

    return {
      id: conv.id,
      tenantId: conv.tenantId,
      sessionId: conv.sessionId,
      contactId: conv.contactId,
      channel: conv.channel,
      status: conv.status,
      unreadCount: conv.unreadCount,
      lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
      lastMessagePreview: conv.lastMessagePreview,
      assignedUserId: conv.assignedUserId,
      queueName: conv.queueName,
      tags: conv.tags,
      notes: conv.notes,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
      contact: {
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        avatarUrl: contact.avatarUrl,
        initials: contact.initials,
      },
      session,
      assignedUser,
    };
  }
}
