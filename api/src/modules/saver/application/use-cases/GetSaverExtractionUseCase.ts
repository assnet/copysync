import type { ISaverExtractionQueue } from '../../domain/contracts/ISaverExtractionQueue';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { assertCanSaver, type SaverActor } from './saverActor';
import { toSaverExtractionDTO, type SaverExtractionDTO } from './saverExtractionDTO';

/** Progresso de uma extração do tenant. */
export class GetSaverExtractionUseCase {
  constructor(private readonly deps: { queue: Pick<ISaverExtractionQueue, 'findExtraction'> }) {}

  async execute(actor: SaverActor, input: { extractionId: string }): Promise<SaverExtractionDTO> {
    assertCanSaver(actor, 'view');
    const e = await this.deps.queue.findExtraction(actor.tenantId, input.extractionId);
    if (!e) throw new NotFoundError('SaverExtraction', input.extractionId);
    return toSaverExtractionDTO(e);
  }
}
