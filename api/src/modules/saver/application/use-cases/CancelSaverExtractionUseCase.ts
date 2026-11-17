import type { ISaverExtractionQueue } from '../../domain/contracts/ISaverExtractionQueue';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { assertCanSaver, type SaverActor } from './saverActor';
import { toSaverExtractionDTO, type SaverExtractionDTO } from './saverExtractionDTO';

export interface CancelSaverExtractionOutput {
  extraction: SaverExtractionDTO;
  /** Itens QUEUED cancelados; o item em andamento termina (SAVER-17). */
  cancelledItems: number;
}

/** Cancela os itens ainda não iniciados de uma extração do tenant. */
export class CancelSaverExtractionUseCase {
  constructor(
    private readonly deps: { queue: Pick<ISaverExtractionQueue, 'findExtraction' | 'cancelQueued'>; now?: () => Date },
  ) {}

  async execute(actor: SaverActor, input: { extractionId: string }): Promise<CancelSaverExtractionOutput> {
    assertCanSaver(actor, 'extract');
    const { tenantId } = actor;
    const found = await this.deps.queue.findExtraction(tenantId, input.extractionId);
    if (!found) throw new NotFoundError('SaverExtraction', input.extractionId);
    const cancelledItems = await this.deps.queue.cancelQueued(tenantId, found.id, this.deps.now?.() ?? new Date());
    const after = (await this.deps.queue.findExtraction(tenantId, found.id)) ?? found;
    return { extraction: toSaverExtractionDTO(after), cancelledItems };
  }
}
