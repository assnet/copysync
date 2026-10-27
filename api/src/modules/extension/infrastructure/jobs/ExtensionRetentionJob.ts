import type { PrismaClient } from '@prisma/client';
import type { IHubOutboxRepository } from '../../domain/contracts/IHubOutboxRepository';
import { logger } from '../../../../shared/logger/logger';

export interface ExtensionRetentionJobOptions {
  prisma: PrismaClient;
  outbox: IHubOutboxRepository;
  intervalMs?: number;
  stopTimeoutMs?: number;
}

const DEFAULT_INTERVAL_MS = 24 * 60 * 60_000;
const DEFAULT_STOP_TIMEOUT_MS = 30_000;
const LEASE_LOCK_ID = 829_401_637;
const SENT_RETENTION_DAYS = 30;
const DEAD_RETENTION_DAYS = 90;
const EVENTS_RETENTION_DAYS = 365;
const SESSION_RETENTION_DAYS = 30;

export class ExtensionRetentionJob {
  private timer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly log = logger.child({ module: 'ExtensionRetentionJob' });

  constructor(private readonly options: ExtensionRetentionJobOptions) {}

  start(): void {
    if (this.timer) return;
    this.startupTimer = setTimeout(() => void this.runTick(), 30_000);
    this.timer = setInterval(() => void this.runTick(), this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.timer) clearInterval(this.timer);
    this.startupTimer = null;
    this.timer = null;
    if (!this.running) return;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), this.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);
    });
    try {
      if (await Promise.race([this.running.then(() => false), timedOut])) {
        this.log.warn('retention job still running at stop');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  runTick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.tickOnce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async tickOnce(): Promise<void> {
    const acquired = await this.tryAcquireLease();
    if (!acquired) return;

    try {
      const now = Date.now();
      let total = 0;

      total += await this.options.outbox.purgeSent(daysAgo(now, SENT_RETENTION_DAYS));
      total += await this.options.outbox.purgeDead(daysAgo(now, DEAD_RETENTION_DAYS));

      const eventsDeleted = await this.options.prisma.extensionLifecycleEvent.deleteMany({
        where: { occurredAt: { lt: daysAgo(now, EVENTS_RETENTION_DAYS) } },
      });
      total += eventsDeleted.count;

      const sessionCutoff = daysAgo(now, SESSION_RETENTION_DAYS);
      const sessionsDeleted = await this.options.prisma.extensionSession.deleteMany({
        where: {
          OR: [
            { revokedAt: { not: null, lt: sessionCutoff } },
            { absoluteExpiresAt: { lt: sessionCutoff } },
          ],
        },
      });
      total += sessionsDeleted.count;

      if (total > 0) this.log.info({ total }, 'extension retention completed');
    } catch (err) {
      this.log.error({ err }, 'extension retention failed');
    } finally {
      await this.releaseLease();
    }
  }

  private async tryAcquireLease(): Promise<boolean> {
    try {
      const result = await this.options.prisma.$queryRaw<[{ acquired: boolean }]>`
        SELECT pg_try_advisory_lock(${LEASE_LOCK_ID}) as acquired
      `;
      return result[0]?.acquired ?? false;
    } catch (err) {
      this.log.warn({ err }, 'lease acquisition failed');
      return false;
    }
  }

  private async releaseLease(): Promise<void> {
    try {
      await this.options.prisma.$queryRaw`SELECT pg_advisory_unlock(${LEASE_LOCK_ID})`;
    } catch { /* best effort */ }
  }
}

function daysAgo(now: number, days: number): Date {
  return new Date(now - days * 24 * 60 * 60_000);
}
