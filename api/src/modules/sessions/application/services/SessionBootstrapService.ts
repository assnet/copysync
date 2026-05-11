import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IMessagingEngine } from '../../../../modules/messaging/domain/contracts/IMessagingEngine';
import { logger } from '../../../../shared/logger/logger';

const bootstrapLogger = logger.child({ module: 'SessionBootstrapService' });

export interface SessionBootstrapOptions {
  maxConcurrent?: number;
}

/**
 * SessionBootstrapService
 *
 * Called once on server startup.  Queries all sessions that were in an active
 * state (connecting / awaiting-qr / awaiting-pairing / connected) when the
 * process last ran and attempts to re-establish the WhatsApp connection for
 * each using the persisted credentials.
 *
 * A failure to reconnect a single session is logged and skipped — it must not
 * prevent the rest of the service from booting.
 */
export class SessionBootstrapService {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly engine: IMessagingEngine,
    private readonly options: SessionBootstrapOptions = {},
  ) {}

  async bootstrap(): Promise<void> {
    let sessions;
    try {
      sessions = await this.sessionRepo.findActiveSessionsForBootstrap();
    } catch (err) {
      bootstrapLogger.error({ err }, 'Failed to query sessions for bootstrap — skipping');
      return;
    }

    if (sessions.length === 0) {
      bootstrapLogger.info('No sessions to bootstrap');
      return;
    }

    const maxConcurrent = Math.max(1, this.options.maxConcurrent ?? 1);
    bootstrapLogger.info(
      { count: sessions.length, maxConcurrent },
      'Bootstrapping active sessions',
    );

    const results: PromiseSettledResult<void>[] = [];

    for (let index = 0; index < sessions.length; index += maxConcurrent) {
      const batch = sessions.slice(index, index + maxConcurrent);
      const batchResults = await Promise.allSettled(
        batch.map(async (session) => {
          try {
            await this.engine.reconnectSession({
              sessionId: session.id,
              tenantId: session.tenantId,
            });
            bootstrapLogger.info({ sessionId: session.id, tenantId: session.tenantId }, 'Session bootstrapped');
          } catch (err) {
            bootstrapLogger.warn({ err, sessionId: session.id }, 'Failed to bootstrap session');
            // Mark as DISCONNECTED so the user knows it needs a manual reconnect
            try {
              await this.sessionRepo.updateStatus(session.id, session.tenantId, {
                status: 'DISCONNECTED',
              });
            } catch { /* best-effort */ }
            throw err;
          }
        }),
      );
      results.push(...batchResults);
    }

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      bootstrapLogger.warn({ failed, total: sessions.length }, 'Some sessions failed to bootstrap');
    } else {
      bootstrapLogger.info({ total: sessions.length }, 'All sessions bootstrapped successfully');
    }
  }
}
