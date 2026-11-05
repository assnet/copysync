import type { IBroadcastGroupRemover } from '../../domain/contracts/IBroadcastGroupRemover';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';

interface Deps {
  groupRemover: IBroadcastGroupRemover;
}

export interface RemoveBroadcastGroupInput {
  tenantId: string;
  conversationId: string;
}

/**
 * Remove o grupo de disparo do gerador e de todos os monitoramentos do tenant (BG-05).
 * Idempotente: grupo do tenant já sem uso não é erro. Conversa de outro tenant (ou inexistente) → 404.
 */
export class RemoveBroadcastGroupUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: RemoveBroadcastGroupInput): Promise<{ removed: number }> {
    const { found, removed } = await this.deps.groupRemover.removeEverywhere(input.tenantId, input.conversationId);
    if (!found) throw new NotFoundError('Group conversation', input.conversationId);
    return { removed };
  }
}
