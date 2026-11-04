import type { ISessionLeaseRepository } from '../../domain/contracts/ISessionLeaseRepository';
import type { SessionLeaseLedger } from '../services/SessionLeaseLedger';
import type { LeaseLogger } from './AcquireSessionLeaseUseCase';
import { logger } from '../../../../shared/logger/logger';

/**
 * Solta o lease depois do socket fechado (LEASE-05): tira do razão sempre e solta no banco
 * se este worker for o dono. Nunca lança; lease não solto vence sozinho no TTL.
 */
export class ReleaseSessionLeaseUseCase {
  constructor(
    private readonly repo: ISessionLeaseRepository,
    private readonly ledger: SessionLeaseLedger,
    private readonly workerId: string,
    private readonly log: LeaseLogger = logger.child({ module: 'ReleaseSessionLease' }),
  ) {}

  async execute(sessionId: string): Promise<void> {
    this.ledger.drop(sessionId);
    try {
      await this.repo.release(sessionId, this.workerId);
    } catch (err) {
      this.log.warn({ err, sessionId }, 'falha ao soltar lease de sessão');
    }
  }
}
