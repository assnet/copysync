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

    // Monta DTO do contato: real para conversas individuais, sintético para grupos
    let contactDto;
    if (conv.isGroup) {
      const gName = conv.groupName ?? conv.groupJid ?? 'Grupo';
      const gInitials = gName.split(' ').slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? '').join('') || 'G';
      // O JID do grupo (<criador>-<timestamp>) é identificador interno, não telefone:
        // publicá-lo em `phone` fazia o painel exibi-lo onde vai o número do contato.
        contactDto = { id: conv.groupJid ?? '', name: gName, phone: '', avatarUrl: conv.groupAvatarUrl ?? null, initials: gInitials };
    } else {
      const contact = await this.contactRepo.findById(conv.contactId ?? '', conv.tenantId);
      if (!contact) throw new NotFoundError('Contact', conv.contactId ?? '');
      contactDto = { id: contact.id, name: contact.name, phone: contact.phone, avatarUrl: contact.avatarUrl, initials: contact.initials };
    }

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
      contact: contactDto,
      session,
      assignedUser,
      isGroup: conv.isGroup,
      groupJid: conv.groupJid,
      groupName: conv.groupName,
      autoDownloadMedia: conv.autoDownloadMedia,
      archived: conv.archived,
      pinned: conv.pinned,
      mutedUntil: conv.mutedUntil?.toISOString() ?? null,
      favorite: conv.favorite,
      manuallyUnread: conv.manuallyUnread,
    };
  }
}
