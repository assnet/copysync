import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { ILinkRotationJobLease } from '../../domain/contracts/ILinkRotationJobLease';
import { SyncLinkRotationMembersUseCase } from '../../application/use-cases/SyncLinkRotationMembersUseCase';
import { PurgeExpiredLinkClicksUseCase } from '../../application/use-cases/PurgeExpiredLinkClicksUseCase';
import { PrismaLinkRotationMemberSyncStore } from '../repositories/PrismaLinkRotationMemberSyncStore';
import { PrismaLinkRotationJobLease } from '../repositories/PrismaLinkRotationJobLease';
import { PrismaLinkClickRepository } from '../repositories/PrismaLinkClickRepository';
import { getActiveEngine } from '../../../../shared/engine/activeEngine';
import { logger } from '../../../../shared/logger/logger';

export const MEMBER_SYNC_LEASE = 'link-rotation-member-sync';

interface JobPart {
  execute(): Promise<{ processed: number }>;
}

export interface LinkRotationMemberSyncJobOptions {
  lease: ILinkRotationJobLease;
  /** `null` quando o engine ainda não subiu: o tick pula a leitura de membros. */
  sync: () => JobPart | null;
  purge: () => JobPart;
  intervalMs?: number;
  stopTimeoutMs?: number;
  /** Vencimento do lease do tick; > duração máxima de um tick (50 leituras). */
  leaseTtlMs?: number;
  now?: () => Date;
}

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_STOP_TIMEOUT_MS = 10_000;
const DEFAULT_LEASE_TTL_MS = 5 * 60_000;

/**
 * Membros dos grupos do rodízio + retenção de cliques (design.md §4.5). Tick de 60 s, um por vez
 * no processo; lease `link-rotation-member-sync` garante 1 processo por tick no cluster.
 * Só é ligado com `LINK_ROTATION_MEMBER_SYNC_ENABLED` (server.ts): escreve no banco e chama o WhatsApp.
 */
export class LinkRotationMemberSyncJob {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly ownerId = randomUUID();
  private readonly log = logger.child({ module: 'LinkRotationMemberSyncJob' });

  constructor(private readonly options: LinkRotationMemberSyncJobOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runTick(), this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.running) return;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), this.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);
    });
    try {
      // Tick preso não segura o shutdown; o lease vence sozinho
      if (await Promise.race([this.running.then(() => false), timedOut])) {
        this.log.warn('member sync tick still running at stop; giving up waiting');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** Exposto para teste; nunca lança. */
  runTick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.tickOnce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async tickOnce(): Promise<void> {
    const { lease } = this.options;
    const now = this.options.now?.() ?? new Date();
    const until = new Date(now.getTime() + (this.options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS));
    let acquired = false;
    try {
      acquired = await lease.tryAcquire(MEMBER_SYNC_LEASE, this.ownerId, until, now);
    } catch (err) {
      this.log.warn({ err: (err as Error)?.name }, 'member sync lease failed');
    }
    if (!acquired) return;
    try {
      const sync = this.options.sync();
      const synced = sync ? await this.safe('member-sync', sync) : 0;
      const purged = await this.safe('click-retention', this.options.purge());
      if (synced > 0 || purged > 0) this.log.debug({ synced, purged }, 'link rotation job tick');
    } finally {
      await lease.release(MEMBER_SYNC_LEASE, this.ownerId).catch(() => undefined);
    }
  }

  private async safe(part: string, job: JobPart): Promise<number> {
    try {
      return (await job.execute()).processed;
    } catch (err) {
      this.log.error({ err: (err as Error)?.name, part }, 'link rotation job part failed');
      return 0;
    }
  }
}

/** Montagem de produção (Prisma + engine ativo resolvido a cada tick). Ligar só com a flag. */
export function createLinkRotationMemberSyncJob(prisma: PrismaClient): LinkRotationMemberSyncJob {
  const lease = new PrismaLinkRotationJobLease(prisma);
  const store = new PrismaLinkRotationMemberSyncStore(prisma);
  const purge = new PurgeExpiredLinkClicksUseCase({ clicks: new PrismaLinkClickRepository(prisma), lease });
  return new LinkRotationMemberSyncJob({
    lease,
    sync: () => {
      const engine = getActiveEngine();
      return engine ? new SyncLinkRotationMembersUseCase({ store, engine }) : null;
    },
    purge: () => purge,
  });
}
