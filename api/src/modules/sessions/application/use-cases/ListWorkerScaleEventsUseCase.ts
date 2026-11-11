import type { IWorkerScaleEventRepository, WorkerScaleEventPage } from '../../domain/contracts/IWorkerScaleEventRepository';

/** Tamanho da página do histórico: decisão do servidor (o cliente só devolve o cursor). */
export const WORKER_SCALE_EVENTS_PAGE_SIZE = 20;

/** Histórico de escala (WSCALE-13), mais recentes primeiro. */
export class ListWorkerScaleEventsUseCase {
  constructor(private readonly events: Pick<IWorkerScaleEventRepository, 'list'>) {}

  execute(beforeId: number | null): Promise<WorkerScaleEventPage> {
    return this.events.list({ beforeId, limit: WORKER_SCALE_EVENTS_PAGE_SIZE });
  }
}
