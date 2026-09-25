import type { IChatListRepository } from '../../domain/contracts/IChatListRepository';
import { normalizeChatListName } from '../../domain/services/normalizeChatListName';
import { NotFoundError, ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import type { ChatListTarget } from './RenameChatListUseCase';

/**
 * Remove a lista do catálogo e de `tags` de todas as conversas do tenant.
 * Por `id`, entrada inexistente é 404; por nome é idempotente (nada a remover = feito).
 */
export class DeleteChatListUseCase {
  constructor(private readonly listRepo: IChatListRepository) {}

  async execute(input: { tenantId: string; target: ChatListTarget }): Promise<void> {
    if ('id' in input.target) {
      const current = await this.listRepo.findById(input.tenantId, input.target.id);
      if (!current) throw new NotFoundError('ChatList', input.target.id);
      await this.listRepo.delete(input.tenantId, current.id);
      return;
    }
    const name = normalizeChatListName(input.target.name);
    if (!name) throw new ValidationError('List name must have 1 to 40 characters');
    await this.listRepo.deleteByName(input.tenantId, name);
  }
}
