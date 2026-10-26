import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { ISessionRepository } from '../../../sessions/domain/contracts/ISessionRepository';
import type { ConversationStatus } from '../../domain/enums/ConversationStatus';
import { extractMentionPhonesFromText, resolveMentionNames } from '../../domain/services/resolveMentionNames';

export interface ListConversationsInput {
  tenantId: string;
  search?: string;
  status?: ConversationStatus;
  sessionId?: string;
  unreadOnly?: boolean;
  /** true = só grupos, false = só individuais; ausente = todas. */
  isGroup?: boolean;
  /** true = só arquivadas; padrão false = só ativas. */
  archived?: boolean;
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
  archived: boolean;
  pinned: boolean;
  mutedUntil: string | null;
  favorite: boolean;
  manuallyUnread: boolean;
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
      isGroup: input.isGroup,
      // Sem filtro explícito a listagem traz apenas as conversas ativas — arquivadas
      // ficam na própria seção, como no WhatsApp Web.
      archived: input.archived ?? false,
    });

    const sessionCache = new Map<string, ConversationSessionDto | null>();

    // Contatos em lote: uma consulta para toda a lista. Buscar um a um dentro do laço
    // custava uma ida ao banco por conversa individual, em série.
    const contactIds = conversations
      .filter((conv) => !conv.isGroup && conv.contactId)
      .map((conv) => conv.contactId as string);
    const contactsById = new Map(
      (await this.contactRepo.findByIds(contactIds, input.tenantId)).map((c) => [c.id, c]),
    );

    // Menção na prévia de grupo chega como `@<telefone>`; o nome do contato do tenant entra
    // só na exibição, numa única consulta para toda a lista.
    const mentionPhones = new Set<string>();
    for (const conv of conversations) {
      if (conv.isGroup && conv.lastMessagePreview) {
        for (const phone of extractMentionPhonesFromText(conv.lastMessagePreview)) mentionPhones.add(phone);
      }
    }
    const mentionNames = new Map<string, string>();
    if (mentionPhones.size > 0) {
      for (const c of await this.contactRepo.findByPhones([...mentionPhones], input.tenantId)) {
        if (c.name && !/^[\d\s+()-]+$/.test(c.name)) mentionNames.set(c.phone, c.name);
      }
    }

    const results: ConversationListItemDto[] = [];

    for (const conv of conversations) {
      let contactDto: ConversationContactDto;

      if (conv.isGroup) {
        // Grupo: monta DTO sintético a partir dos dados do grupo
        const gName = conv.groupName ?? conv.groupJid ?? 'Grupo';
        const gInitials = gName.split(' ').slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? '').join('') || 'G';
        // O JID do grupo (<criador>-<timestamp>) é identificador interno, não telefone:
        // publicá-lo em `phone` fazia o painel exibi-lo onde vai o número do contato.
        contactDto = { id: conv.groupJid ?? '', name: gName, phone: '', avatarUrl: conv.groupAvatarUrl ?? null, initials: gInitials };
      } else {
        if (!conv.contactId) continue; // conversa individual sem contactId — dado inválido
        const contact = contactsById.get(conv.contactId);
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
        lastMessagePreview:
          conv.isGroup && conv.lastMessagePreview
            ? resolveMentionNames(conv.lastMessagePreview, mentionNames)
            : conv.lastMessagePreview,
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
        archived: conv.archived,
        pinned: conv.pinned,
        mutedUntil: conv.mutedUntil?.toISOString() ?? null,
        favorite: conv.favorite,
        manuallyUnread: conv.manuallyUnread,
      });
    }

    return results;
  }
}
