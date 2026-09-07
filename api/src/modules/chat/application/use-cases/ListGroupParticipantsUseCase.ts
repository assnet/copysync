import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';

export interface ListGroupParticipantsInput {
  conversationId: string;
  tenantId: string;
}

export interface GroupParticipantDto {
  /** Telefone em dígitos, ou null quando o participante não o revela. */
  phone: string | null;
  name: string;
  avatarUrl: string | null;
  initials: string;
  isAdmin: boolean;
}

function buildInitials(name: string): string {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  return initials || '?';
}

/**
 * Lista os participantes de uma conversa de grupo.
 *
 * O nome e o avatar vêm do contato já conhecido do tenant quando existe; caso
 * contrário usa-se o nome que o WhatsApp fornece e, na falta dele, o telefone.
 */
export class ListGroupParticipantsUseCase {
  constructor(
    private readonly conversationRepo: IChatConversationRepository,
    private readonly contactRepo: IChatContactRepository,
    private readonly engine: IMessagingEngine,
  ) {}

  async execute(input: ListGroupParticipantsInput): Promise<GroupParticipantDto[]> {
    const conversation = await this.conversationRepo.findById(input.conversationId, input.tenantId);
    if (!conversation) throw new NotFoundError('Conversation', input.conversationId);

    if (!conversation.isGroup || !conversation.groupJid || !conversation.sessionId) return [];

    const participants = await this.engine.getGroupParticipants(
      conversation.sessionId,
      conversation.groupJid,
    );

    // Enriquecimento em lote — nunca uma consulta por participante.
    const phones = participants.map((p) => p.phone).filter((p): p is string => p !== null);
    const contactsByPhone = new Map(
      (await this.contactRepo.findByPhones(phones, input.tenantId)).map((c) => [c.phone, c]),
    );

    return participants.map((participant) => {
      const contact = participant.phone ? contactsByPhone.get(participant.phone) : undefined;
      const name = contact?.name ?? participant.name ?? participant.phone ?? 'Participante';

      return {
        phone: participant.phone,
        name,
        avatarUrl: contact?.avatarUrl ?? null,
        initials: buildInitials(name),
        isAdmin: participant.isAdmin,
      };
    });
  }
}
