import type { ISessionLeaseGate, ISessionLeaseRepository } from '../../domain/contracts/ISessionLeaseRepository';
import { LEASE_TTL_MS } from '../../domain/services/sessionLeasePolicy';
import type { SessionLeaseLedger } from '../services/SessionLeaseLedger';
import { logger } from '../../../../shared/logger/logger';

export type LeaseLogger = Pick<typeof logger, 'warn'>;

/**
 * Adquire o lease antes de abrir socket (LEASE-03). `false` = outro processo é dono ou o
 * banco falhou (não abre). Sucesso grava no razão local para o keeper renovar.
 */
export class AcquireSessionLeaseUseCase implements ISessionLeaseGate {
  constructor(
    private readonly repo: ISessionLeaseRepository,
    private readonly ledger: SessionLeaseLedger,
    private readonly workerId: string,
    private readonly now: () => Date = () => new Date(),
    private readonly log: LeaseLogger = logger.child({ module: 'AcquireSessionLease' }),
  ) {}

  async acquire(sessionId: string): Promise<boolean> {
    try {
      const ok = await this.repo.tryAcquire(sessionId, this.workerId, LEASE_TTL_MS);
      if (ok) this.ledger.markOk(sessionId, this.now());
      return ok;
    } catch (err) {
      this.log.warn({ err, sessionId }, 'falha ao adquirir lease de sessão');
      return false;
    }
  }
}
