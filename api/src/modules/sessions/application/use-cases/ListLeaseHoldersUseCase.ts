import type { ISessionLeaseHolderRepository, SessionLeaseHolder } from '../../domain/contracts/ISessionLeaseHolderRepository';

export interface ListLeaseHoldersOutput {
  processes: SessionLeaseHolder[];
  /** Soma das sessões com lease vivo. */
  leasedSessions: number;
}

/**
 * Adoção por capacidade desligada: sem heartbeat, os processos aparecem pelos leases vivos.
 * Sem teto (WORKER_MAX_SESSIONS só vale com adoção). Dado de plataforma, sem tenant.
 */
export class ListLeaseHoldersUseCase {
  constructor(private readonly holders: ISessionLeaseHolderRepository) {}

  async execute(): Promise<ListLeaseHoldersOutput> {
    const processes = await this.holders.listLiveHolders();
    return { processes, leasedSessions: processes.reduce((n, p) => n + p.sessions, 0) };
  }
}
