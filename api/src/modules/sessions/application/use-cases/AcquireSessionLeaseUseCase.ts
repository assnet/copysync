import type { ISessionLeaseGate, ISessionLeaseRepository } from '../../domain/contracts/ISessionLeaseRepository';
import { LEASE_TTL_MS } from '../../domain/services/sessionLeasePolicy';
import type { SessionLeaseLedger } from '../services/SessionLeaseLedger';
import { logger } from '../../../../shared/logger/logger';

export type LeaseLogger = Pick<typeof logger, 'warn'>;

/** `held` = outro processo é dono (prova); `error` = banco falhou (sem prova, vale tentar de novo). */
export type LeaseAcquireResult = 'acquired' | 'held' | 'error';

/**
 * Adquire o lease antes de abrir socket (LEASE-03). `acquireResult` distingue outro dono de
 * erro de banco; `acquire` (porta dos adapters) segue booleana: `false` = não abre.
 * Sucesso grava no razão local para o keeper renovar.
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
    return (await this.acquireResult(sessionId)) === 'acquired';
  }

  async acquireResult(sessionId: string): Promise<LeaseAcquireResult> {
    try {
      const ok = await this.repo.tryAcquire(sessionId, this.workerId, LEASE_TTL_MS);
      if (!ok) return 'held';
      this.ledger.markOk(sessionId, this.now());
      return 'acquired';
    } catch (err) {
      this.log.warn({ err, sessionId }, 'falha ao adquirir lease de sessão');
      return 'error';
    }
  }
}
