import type { ISessionLeaseRepository } from '../../domain/contracts/ISessionLeaseRepository';
import type { ISessionSocketControl } from '../../../messaging/domain/contracts/ISessionSocketControl';
import {
  LEASE_RENEW_TIMEOUT_MS,
  LEASE_TTL_MS,
  isLeaseFenceExpired,
} from '../../domain/services/sessionLeasePolicy';
import type { SessionLeaseLedger } from '../services/SessionLeaseLedger';
import type { LeaseLogger } from './AcquireSessionLeaseUseCase';
import { logger } from '../../../../shared/logger/logger';

const RENEW_TIMEOUT = Symbol('renew-timeout');

/**
 * Rodada de renovação do lease (LEASE-04, D4). Só renova sessões no razão local **e** com
 * socket local. Zero linhas para um id = lease perdido → derruba já. Erro/timeout = vale o
 * fence (`isLeaseFenceExpired`): derruba só quem passou de TTL − margem sem renovar.
 * Derrubar = `abortSession` (sem gravar status nem auth state) + tirar do razão.
 */
export class RenewSessionLeaseUseCase {
  constructor(
    private readonly repo: ISessionLeaseRepository,
    private readonly ledger: SessionLeaseLedger,
    private readonly sockets: ISessionSocketControl,
    private readonly workerId: string,
    private readonly now: () => Date = () => new Date(),
    private readonly log: LeaseLogger = logger.child({ module: 'RenewSessionLease' }),
  ) {}

  async execute(): Promise<void> {
    const local = new Set(this.sockets.listLocalSessionIds());
    const candidates: string[] = [];
    for (const id of this.ledger.ids()) {
      if (local.has(id)) candidates.push(id);
      else this.ledger.drop(id);
    }

    // Fence antes do banco: quem já passou do limite não espera mais uma chamada.
    const ids = await this.abortFenced(candidates);
    if (ids.length === 0) return;

    const startedAt = this.now();
    let renewed: string[];
    try {
      renewed = await this.renewWithTimeout(ids);
    } catch (err) {
      this.log.warn({ err, count: ids.length }, 'falha ao renovar lease de sessão');
      await this.abortFenced(ids);
      return;
    }

    const ok = new Set(renewed);
    const lost: string[] = [];
    for (const id of ids) {
      if (ok.has(id)) this.ledger.markOk(id, startedAt);
      else lost.push(id);
    }
    if (lost.length > 0) {
      this.log.warn({ sessionIds: lost }, 'lease de sessão perdido; derrubando socket');
      await this.abortAll(lost);
    }
  }

  /** Derruba os ids com fence vencido e devolve os que seguem válidos. */
  private async abortFenced(ids: readonly string[]): Promise<string[]> {
    const now = this.now();
    const expired: string[] = [];
    const alive: string[] = [];
    for (const id of ids) {
      const last = this.ledger.lastOk(id);
      if (!last || isLeaseFenceExpired(last, now)) expired.push(id);
      else alive.push(id);
    }
    if (expired.length > 0) {
      this.log.warn({ sessionIds: expired }, 'fence de lease vencido; derrubando socket');
      await this.abortAll(expired);
    }
    return alive;
  }

  private async abortAll(ids: readonly string[]): Promise<void> {
    await Promise.all(
      ids.map(async (id) => {
        this.ledger.drop(id);
        try {
          await this.sockets.abortSession(id);
        } catch (err) {
          this.log.warn({ err, sessionId: id }, 'falha ao derrubar socket sem lease');
        }
      }),
    );
  }

  private async renewWithTimeout(ids: readonly string[]): Promise<string[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof RENEW_TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(RENEW_TIMEOUT), LEASE_RENEW_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([this.repo.renew(ids, this.workerId, LEASE_TTL_MS), timeout]);
      if (result === RENEW_TIMEOUT) throw new Error(`renovação de lease excedeu ${LEASE_RENEW_TIMEOUT_MS} ms`);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
}
