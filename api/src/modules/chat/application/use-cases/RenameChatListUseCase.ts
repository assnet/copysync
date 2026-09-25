import type { IChatListRepository } from '../../domain/contracts/IChatListRepository';
import { normalizeChatListName, sameChatListName } from '../../domain/services/normalizeChatListName';
import { ConflictError, NotFoundError, ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import type { ChatListDto } from './ListChatListsUseCase';

/** Alvo: entrada do catálogo (`id`) ou nome que só existe em `tags` (`name`). */
export type ChatListTarget = { id: string } | { name: string };

export interface RenameChatListInput {
  tenantId: string;
  target: ChatListTarget;
  newName: string;
}

/**
 * Renomeia a lista no catálogo e em cascata em `tags` das conversas do tenant.
 * Só a caixa mudou ("vip" → "VIP")? Não é conflito: é a própria lista.
 */
export class RenameChatListUseCase {
  constructor(private readonly listRepo: IChatListRepository) {}

  async execute(input: RenameChatListInput): Promise<ChatListDto> {
    const newName = normalizeChatListName(input.newName);
    if (!newName) throw new ValidationError('List name must have 1 to 40 characters');

    const oldName = await this.resolveOldName(input);
    const clash = await this.listRepo.findByName(input.tenantId, newName);
    if (clash && !sameChatListName(clash.name, oldName)) {
      throw new ConflictError(`A list named "${clash.name}" already exists`);
    }

    const list = 'id' in input.target
      ? await this.listRepo.rename(input.tenantId, input.target.id, newName)
      : await this.listRepo.renameByName(input.tenantId, oldName, newName);
    const conversationCount = await this.listRepo.countConversations(input.tenantId, list.name);

    return { id: list.id, name: list.name, conversationCount };
  }

  private async resolveOldName(input: RenameChatListInput): Promise<string> {
    if ('id' in input.target) {
      const current = await this.listRepo.findById(input.tenantId, input.target.id);
      if (!current) throw new NotFoundError('ChatList', input.target.id);
      return current.name;
    }
    const oldName = normalizeChatListName(input.target.name);
    if (!oldName) throw new ValidationError('List name must have 1 to 40 characters');
    return oldName;
  }
}
