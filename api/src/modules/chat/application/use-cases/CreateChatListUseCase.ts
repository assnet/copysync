import type { IChatListRepository } from '../../domain/contracts/IChatListRepository';
import { normalizeChatListName } from '../../domain/services/normalizeChatListName';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import type { ChatListDto } from './ListChatListsUseCase';

export interface CreateChatListResult {
  list: ChatListDto;
  /** false quando o nome já existia: a resposta é a lista existente (idempotente). */
  created: boolean;
}

export class CreateChatListUseCase {
  constructor(private readonly listRepo: IChatListRepository) {}

  async execute(input: { tenantId: string; name: string }): Promise<CreateChatListResult> {
    const name = normalizeChatListName(input.name);
    if (!name) throw new ValidationError('List name must have 1 to 40 characters');

    const existing = await this.listRepo.findByName(input.tenantId, name);
    const list = existing ?? await this.listRepo.ensure(input.tenantId, name);
    const conversationCount = await this.listRepo.countConversations(input.tenantId, list.name);

    return { list: { id: list.id, name: list.name, conversationCount }, created: !existing };
  }
}
