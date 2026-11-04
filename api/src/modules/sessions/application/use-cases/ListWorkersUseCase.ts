import type { IWorkerHeartbeatRepository, WorkerHeartbeat } from '../../domain/contracts/IWorkerHeartbeatRepository';
import type { ISessionAdoptionRepository } from '../../domain/contracts/ISessionAdoptionRepository';
import { WORKER_ALIVE_MS } from '../../domain/services/sessionAdoptionPolicy';

export interface WorkerOccupancyTotals {
  /** Workers vivos (batimento < 90 s). */
  workers: number;
  /** Soma das sessões abertas ou abrindo nos workers vivos. */
  sessions: number;
  /** Soma dos tetos (`WORKER_MAX_SESSIONS`) dos workers vivos. */
  maxSessions: number;
}

export interface ListWorkersOutput {
  workers: WorkerHeartbeat[];
  totals: WorkerOccupancyTotals;
  /** Sessões com pedido vivo e sem dono vivo (aguardando capacidade). */
  awaiting: number;
}

/** Ocupação dos workers para o super-admin (ADOPT-12). Dado de plataforma, sem tenant. */
export class ListWorkersUseCase {
  constructor(
    private readonly heartbeats: IWorkerHeartbeatRepository,
    private readonly adoption: Pick<ISessionAdoptionRepository, 'countAwaitingCapacity'>,
  ) {}

  async execute(): Promise<ListWorkersOutput> {
    const [workers, awaiting] = await Promise.all([
      this.heartbeats.listAlive(WORKER_ALIVE_MS),
      this.adoption.countAwaitingCapacity(),
    ]);
    const totals = workers.reduce<WorkerOccupancyTotals>(
      (t, w) => ({ workers: t.workers + 1, sessions: t.sessions + w.sessions, maxSessions: t.maxSessions + w.maxSessions }),
      { workers: 0, sessions: 0, maxSessions: 0 },
    );
    return { workers, totals, awaiting };
  }
}
