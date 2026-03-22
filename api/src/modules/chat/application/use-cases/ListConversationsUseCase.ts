import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { ISessionRepository } from '../../../sessions/domain/contracts/ISessionRepository';
import type { ConversationStatus } from '../../domain/enums/ConversationStatus';

export interface ListConversationsInput {
  tenantId: string;
  search?: string;
  status?: ConversationStatus;
  sessionId?: string;
  unreadOnly?: boolean;
}

export interface ConversationContactDto {
  id: string;
  name: string;
  phone: string;
  avatarUrl: string | null;
  initials: string;
}

export interface ConversationSessionDto {
  id: string;
  name: string;
  phone: string | null;
  status: string;
}

export interface ConversationAssignedUserDto {
  id: string;
  name: string;
}

export interface ConversationListItemDto {
  id: string;
  tenantId: string;
  sessionId: string | null;
  contactId: string | null;
  channel: string;
  status: ConversationStatus;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  assignedUserId: string | null;
  queueName: string | null;
  tags: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  contact: ConversationContactDto;
  session: ConversationSessionDto | null;
  assignedUser: ConversationAssignedUserDto | null;
  isGroup?: boolean;
  groupJid?: string | null;
  groupName?: string | null;
  autoDownloadMedia?: boolean;
}

export class ListConversationsUseCase {
  constructor(
    private readonly conversationRepo: IChatConversationRepository,
    private readonly contactRepo: IChatContactRepository,
    private readonly sessionRepo: ISessionRepository,
  ) {}

  async execute(input: ListConversationsInput): Promise<ConversationListItemDto[]> {
    const conversations = await this.conversationRepo.findMany({
      tenantId: input.tenantId,
      search: input.search,
      status: input.status,
      sessionId: input.sessionId,
      unreadOnly: input.unreadOnly,
    });

    const sessionCache = new Map<string, ConversationSessionDto | null>();

    const results: ConversationListItemDto[] = [];

    for (const conv of conversations) {
      let contactDto: ConversationContactDto;

      if (conv.isGroup) {
        // Grupo: monta DTO sintético a partir dos dados do grupo
        const gName = conv.groupName ?? conv.groupJid ?? 'Grupo';
        const gInitials = gName.split(' ').slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? '').join('') || 'G';
        contactDto = { id: conv.groupJid ?? '', name: gName, phone: conv.groupJid ?? '', avatarUrl: conv.groupAvatarUrl ?? null, initials: gInitials };
      } else {
        if (!conv.contactId) continue; // conversa individual sem contactId — dado inválido
        const contact = await this.contactRepo.findById(conv.contactId, conv.tenantId);
        if (!contact) continue;
        contactDto = { id: contact.id, name: contact.name, phone: contact.phone, avatarUrl: contact.avatarUrl, initials: contact.initials };
      }

      let session: ConversationSessionDto | null = null;
      if (conv.sessionId) {
        if (sessionCache.has(conv.sessionId)) {
          session = sessionCache.get(conv.sessionId) ?? null;
        } else {
          const sess = await this.sessionRepo.findById(conv.sessionId, conv.tenantId);
          if (sess) {
            session = {
              id: sess.id,
              name: sess.name,
              phone: sess.phone,
              status: sess.status,
            };
          }
          sessionCache.set(conv.sessionId, session);
        }
      }

      results.push({
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
        assignedUser: null,
        isGroup: conv.isGroup,
        groupJid: conv.groupJid,
        groupName: conv.groupName,
        autoDownloadMedia: conv.autoDownloadMedia,
      });
    }

    return results;
  }
}
