import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';

export interface ListGroupParticipantsInput {
  conversationId: string;
  tenantId: string;
  /** Página pedida; o painel nunca recebe a lista inteira. */
  limit?: number;
  offset?: number;
  /** Filtra por nome ou telefone, para a busca do modal. */
  search?: string;
}

export interface ListGroupParticipantsOutput {
  participants: GroupParticipantDto[];
  /** Total no grupo, para o painel saber quantos faltam. */
  total: number;
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
  // Participante desconhecido tem o próprio número como nome; a inicial seria o
  // primeiro dígito ("5"), que não identifica ninguém. Nesse caso não há iniciais e
  // o painel usa o ícone genérico de pessoa.
  if (/^[\d\s+()-]+$/.test(name)) return '';

  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  return initials;
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

  async execute(input: ListGroupParticipantsInput): Promise<ListGroupParticipantsOutput> {
    const conversation = await this.conversationRepo.findById(input.conversationId, input.tenantId);
    if (!conversation) throw new NotFoundError('Conversation', input.conversationId);

    if (!conversation.isGroup || !conversation.groupJid || !conversation.sessionId) {
      return { participants: [], total: 0 };
    }

    const all = await this.engine.getGroupParticipants(
      conversation.sessionId,
      conversation.groupJid,
    );

    const term = input.search?.trim().toLowerCase();
    const filtered = term
      ? all.filter((p) =>
          (p.name ?? '').toLowerCase().includes(term) || (p.phone ?? '').includes(term.replace(/\D/g, '')),
        )
      : all;

    // Só a fatia pedida deixa o servidor: a lista completa de um grupo grande é dado
    // pessoal de centenas de pessoas e não tem por que trafegar inteira.
    const offset = Math.max(0, input.offset ?? 0);
    const limit = Math.min(Math.max(1, input.limit ?? 10), 50);
    const participants = filtered.slice(offset, offset + limit);

    // Enriquecimento em lote — nunca uma consulta por participante.
    const phones = participants.map((p) => p.phone).filter((p): p is string => p !== null);
    const contactsByPhone = new Map(
      (await this.contactRepo.findByPhones(phones, input.tenantId)).map((c) => [c.phone, c]),
    );

    const page = participants.map((participant) => {
      const contact = participant.phone ? contactsByPhone.get(participant.phone) : undefined;
      const name = contact?.name ?? participant.name ?? participant.phone ?? 'Participante';

      return {
        phone: participant.phone,
        name,
        // A foto vinda do WhatsApp é a mais atual; o contato do tenant é fallback.
        avatarUrl: participant.avatarUrl ?? contact?.avatarUrl ?? null,
        initials: buildInitials(name),
        isAdmin: participant.isAdmin,
      };
    });

    return { participants: page, total: filtered.length };
  }
}
