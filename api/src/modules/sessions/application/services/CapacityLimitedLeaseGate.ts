import type { ISessionLeaseGate } from '../../domain/contracts/ISessionLeaseRepository';
import { logger } from '../../../../shared/logger/logger';

export type CapacityGateLogger = Pick<typeof logger, 'warn'>;

/**
 * Teto de sessões no gate do lease (ADOPT-06). Decora o gate real (`AcquireSessionLeaseUseCase`):
 * sessão já local (inclui socket abrindo) sempre repassa; com `ativas >= max` nega sessão nova.
 * `false` cai no 503 existente da rota (D3). Sem env: `max` e `listLocal` vêm de quem monta.
 */
export class CapacityLimitedLeaseGate implements ISessionLeaseGate {
  constructor(
    private readonly inner: ISessionLeaseGate,
    private readonly listLocal: () => string[],
    private readonly max: number,
    private readonly log: CapacityGateLogger = logger.child({ module: 'CapacityLimitedLeaseGate' }),
  ) {}

  async acquire(sessionId: string): Promise<boolean> {
    const local = this.listLocal();
    if (!local.includes(sessionId) && local.length >= this.max) {
      this.log.warn({ sessionId, active: local.length, max: this.max }, 'teto de sessões atingido; lease negado');
      return false;
    }
    try {
      return await this.inner.acquire(sessionId);
    } catch (err) {
      this.log.warn({ err, sessionId }, 'falha ao adquirir lease de sessão');
      return false;
    }
  }
}
