import { randomUUID } from 'node:crypto';
import type { ILinkClickRepository } from '../../domain/contracts/ILinkClickRepository';
import type { ILinkRotationJobLease } from '../../domain/contracts/ILinkRotationJobLease';

export const LINK_CLICK_RETENTION_DAYS = 90;
export const LINK_CLICK_RETENTION_INTERVAL_MS = 60 * 60_000;
export const LINK_CLICK_RETENTION_LEASE = 'link-click-retention';

export interface PurgeExpiredLinkClicksDeps {
  clicks: Pick<ILinkClickRepository, 'deleteOlderThan'>;
  lease: ILinkRotationJobLease;
  now?: () => Date;
}

/**
 * Retenção de `LinkClick` (90 dias), no máximo 1×/hora somando todos os processos: o lease
 * `link-click-retention` vale 1 h e não é liberado — é a trava de frequência, fora da memória.
 * Devolve linhas apagadas (0 quando ainda não é hora).
 */
export class PurgeExpiredLinkClicksUseCase {
  private readonly ownerId = randomUUID();

  constructor(private readonly deps: PurgeExpiredLinkClicksDeps) {}

  async execute(): Promise<{ processed: number }> {
    const now = this.deps.now?.() ?? new Date();
    const until = new Date(now.getTime() + LINK_CLICK_RETENTION_INTERVAL_MS);
    if (!(await this.deps.lease.tryAcquire(LINK_CLICK_RETENTION_LEASE, this.ownerId, until, now))) {
      return { processed: 0 };
    }
    const cutoff = new Date(now.getTime() - LINK_CLICK_RETENTION_DAYS * 86_400_000);
    return { processed: await this.deps.clicks.deleteOlderThan(cutoff) };
  }
}
