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
  contactId: string;
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
      const contact = await this.contactRepo.findById(conv.contactId, conv.tenantId);
      if (!contact) continue;

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
        contact: {
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          avatarUrl: contact.avatarUrl,
          initials: contact.initials,
        },
        session,
        assignedUser: null, // expandido no GetConversationByIdUseCase se necessário
      });
    }

    return results;
  }
}
