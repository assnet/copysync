import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import type { ConversationStatus } from '../../domain/enums/ConversationStatus';
import type { ConversationListItemDto } from './ListConversationsUseCase';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { ISessionRepository } from '../../../sessions/domain/contracts/ISessionRepository';
import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';

export interface UpdateConversationInput {
  conversationId: string;
  tenantId: string;
  status?: ConversationStatus;
  assignedUserId?: string | null;
  queueName?: string | null;
  tags?: string[];
  notes?: string | null;
}

export class UpdateConversationUseCase {
  constructor(
    private readonly conversationRepo: IChatConversationRepository,
    private readonly contactRepo: IChatContactRepository,
    private readonly sessionRepo: ISessionRepository,
    private readonly userRepo: IUserRepository,
  ) {}

  async execute(input: UpdateConversationInput): Promise<ConversationListItemDto> {
    const existing = await this.conversationRepo.findById(
      input.conversationId,
      input.tenantId,
    );
    if (!existing) throw new NotFoundError('Conversation', input.conversationId);

    const updated = await this.conversationRepo.update(
      input.conversationId,
      input.tenantId,
      {
        status: input.status,
        assignedUserId: input.assignedUserId,
        queueName: input.queueName,
        tags: input.tags,
        notes: input.notes,
      },
    );

    const contact = await this.contactRepo.findById(updated.contactId ?? '', updated.tenantId);
    if (!updated.isGroup && !contact) throw new NotFoundError('Contact', updated.contactId ?? '');

    const contactDto = updated.isGroup
      ? (() => {
          const gName = updated.groupName ?? updated.groupJid ?? 'Grupo';
          const gInitials = gName.split(' ').slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? '').join('') || 'G';
          return { id: updated.groupJid ?? '', name: gName, phone: updated.groupJid ?? '', avatarUrl: null as string | null, initials: gInitials };
        })()
      : { id: contact!.id, name: contact!.name, phone: contact!.phone, avatarUrl: contact!.avatarUrl, initials: contact!.initials };

    let session = null;
    if (updated.sessionId) {
      const sess = await this.sessionRepo.findById(updated.sessionId, updated.tenantId);
      if (sess) session = { id: sess.id, name: sess.name, phone: sess.phone, status: sess.status };
    }

    let assignedUser = null;
    if (updated.assignedUserId) {
      const user = await this.userRepo.findById(updated.assignedUserId);
      if (user) assignedUser = { id: user.id, name: user.name };
    }

    return {
      id: updated.id,
      tenantId: updated.tenantId,
      sessionId: updated.sessionId,
      contactId: updated.contactId,
      channel: updated.channel,
      status: updated.status,
      unreadCount: updated.unreadCount,
      lastMessageAt: updated.lastMessageAt?.toISOString() ?? null,
      lastMessagePreview: updated.lastMessagePreview,
      assignedUserId: updated.assignedUserId,
      queueName: updated.queueName,
      tags: updated.tags,
      notes: updated.notes,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      contact: contactDto,
      session,
      assignedUser,
      isGroup: updated.isGroup,
      groupJid: updated.groupJid,
      groupName: updated.groupName,
    };
  }
}
