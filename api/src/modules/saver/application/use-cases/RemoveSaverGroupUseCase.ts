import type { ISaverExtractionQueue } from '../../domain/contracts/ISaverExtractionQueue';
import type { ISaverGroupRepository } from '../../domain/contracts/ISaverGroupRepository';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { assertCanSaver, type SaverActor } from './saverActor';

/**
 * Remove um grupo salvo (SAVER-33): só `configure`; cancela itens pendentes e marca `removedAt`.
 * Remoção lógica: libera o limite, vínculos e contatos ficam (nenhum `DELETE`). Pedir de novo reativa.
 */
export class RemoveSaverGroupUseCase {
  constructor(
    private readonly deps: {
      groups: Pick<ISaverGroupRepository, 'findById' | 'markRemoved'>;
      queue: Pick<ISaverExtractionQueue, 'cancelPendingByGroup'>;
      now?: () => Date;
    },
  ) {}

  async execute(actor: SaverActor, input: { groupId: string }): Promise<void> {
    assertCanSaver(actor, 'configure');
    const { tenantId } = actor;
    const group = await this.deps.groups.findById(tenantId, input.groupId);
    if (!group || group.removedAt !== null) throw new NotFoundError('SaverGroup', input.groupId);
    const now = this.deps.now?.() ?? new Date();
    await this.deps.queue.cancelPendingByGroup(tenantId, group.id, now);
    await this.deps.groups.markRemoved(tenantId, group.id, now);
  }
}
