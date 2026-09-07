import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { ISessionRepository } from '../../../sessions/domain/contracts/ISessionRepository';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';

export interface StartConversationInput {
  tenantId: string;
  /** Sessão pela qual a conversa será conduzida. */
  sessionId: string;
  /** Telefone em dígitos, sem @s.whatsapp.net. */
  phone: string;
  /** Nome conhecido do contato, usado apenas na criação. */
  name?: string;
}

export interface StartConversationOutput {
  conversationId: string;
  /** true quando a conversa acabou de ser criada. */
  created: boolean;
}

/**
 * Abre a conversa individual com um contato, criando-a se ainda não existir.
 *
 * Usada ao escolher "Conversar com" a partir de um participante de grupo: até então
 * a ação não levava a lugar nenhum quando não havia conversa prévia.
 *
 * Reaproveita a conversa ativa existente para não duplicar o histórico — a mesma
 * regra que a ingestão de mensagens usa.
 */
export class StartConversationUseCase {
  constructor(
    private readonly conversationRepo: IChatConversationRepository,
    private readonly contactRepo: IChatContactRepository,
    private readonly sessionRepo: ISessionRepository,
  ) {}

  async execute(input: StartConversationInput): Promise<StartConversationOutput> {
    const session = await this.sessionRepo.findById(input.sessionId, input.tenantId);
    if (!session) throw new NotFoundError('Session', input.sessionId);

    const contact = await this.contactRepo.findOrCreate({
      tenantId: input.tenantId,
      phone: input.phone,
      name: input.name?.trim() || input.phone,
    });

    const existing = await this.conversationRepo.findActiveByContactAndSession(
      contact.id,
      input.sessionId,
      input.tenantId,
    );
    if (existing) return { conversationId: existing.id, created: false };

    const conversation = await this.conversationRepo.create({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      contactId: contact.id,
      channel: 'whatsapp',
      isGroup: false,
    });

    return { conversationId: conversation.id, created: true };
  }
}
