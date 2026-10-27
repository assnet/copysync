import type { IHubOutboxRepository, OutboxHeadEvent } from '../../domain/contracts/IHubOutboxRepository';
import { signHubRequest } from './hmacSigner';
import { logger } from '../../../../shared/logger/logger';

export interface HubOutboxWorkerOptions {
  repository: IHubOutboxRepository;
  hubUrl: string;
  applicationKey: string;
  secret: string;
  intervalMs?: number;
  lockDurationMs?: number;
  stopTimeoutMs?: number;
}

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_LOCK_DURATION_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 10;
const FETCH_TIMEOUT_MS = 8_000;
const MIN_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 24 * 60 * 60_000;

export class HubOutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly log = logger.child({ module: 'HubOutboxWorker' });

  constructor(private readonly options: HubOutboxWorkerOptions) {}

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
      if (await Promise.race([this.running.then(() => false), timedOut])) {
        this.log.warn('hub outbox tick still running at stop; giving up waiting');
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
    try {
      const lockDuration = this.options.lockDurationMs ?? DEFAULT_LOCK_DURATION_MS;
      const lockedUntil = new Date(Date.now() + lockDuration);
      const heads = await this.options.repository.claimHeads(lockedUntil);

      let processed = 0;
      for (const event of heads) {
        await this.processEvent(event);
        processed++;
      }
      if (processed > 0) this.log.debug({ processed }, 'hub outbox events processed');
    } catch (err) {
      this.log.error({ err }, 'hub outbox tick failed');
    }
  }

  private async processEvent(event: OutboxHeadEvent): Promise<void> {
    const eventsPath = '/events';
    const body = JSON.stringify({
      eventId: event.id,
      type: event.type,
      clientKey: event.clientKey,
      installationId: event.installationId,
      payload: event.payload,
    });

    const headers = signHubRequest({
      method: 'POST',
      path: eventsPath,
      body,
      applicationKey: this.options.applicationKey,
      secret: this.options.secret,
    });

    try {
      const response = await fetch(`${this.options.hubUrl}${eventsPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (response.ok) {
        await this.options.repository.markSent(event.id);
        return;
      }

      const status = response.status;
      if (status >= 400 && status < 500) {
        this.log.warn({ eventId: event.id, type: event.type, clientKey: event.clientKey, status }, 'hub rejected event (4xx), marking DEAD');
        await this.options.repository.markDead(event.id);
        return;
      }

      await this.handleRetry(event, `HTTP ${status}`);
    } catch (err) {
      await this.handleRetry(event, (err as Error)?.name ?? 'NetworkError');
    }
  }

  private async handleRetry(event: OutboxHeadEvent, reason: string): Promise<void> {
    const attempt = event.attempts + 1;
    if (attempt >= MAX_ATTEMPTS) {
      this.log.warn({ eventId: event.id, type: event.type, clientKey: event.clientKey, attempt, reason }, 'max attempts reached, marking DEAD');
      await this.options.repository.markDead(event.id);
      return;
    }

    const backoff = Math.min(MIN_BACKOFF_MS * 2 ** event.attempts, MAX_BACKOFF_MS);
    const nextAttemptAt = new Date(Date.now() + backoff);
    this.log.info({ eventId: event.id, type: event.type, clientKey: event.clientKey, attempt, reason, nextAttemptAt }, 'scheduling retry');
    await this.options.repository.scheduleRetry(event.id, nextAttemptAt);
  }
}
