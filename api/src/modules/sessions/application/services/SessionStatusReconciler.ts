import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import { logger } from '../../../../shared/logger/logger';

const reconcilerLogger = logger.child({ module: 'SessionStatusReconciler' });

/**
 * SessionStatusReconciler
 *
 * Sockets live in process memory, so a restart drops every WhatsApp connection —
 * but the status written before the shutdown survives in the database. Without
 * reconciliation a session reads CONNECTED in the panel while no socket exists and
 * no message arrives, which is indistinguishable from a healthy session nobody is
 * writing to.
 *
 * Used on startup when session bootstrap is disabled. With bootstrap enabled the
 * sessions are reconnected instead, and the ones that fail are marked DISCONNECTED
 * by SessionBootstrapService.
 */
export class SessionStatusReconciler {
  constructor(private readonly sessionRepo: ISessionRepository) {}

  async markActiveSessionsAsDisconnected(): Promise<void> {
    let sessions;
    try {
      sessions = await this.sessionRepo.findActiveSessionsForBootstrap();
    } catch (err) {
      reconcilerLogger.error({ err }, 'Failed to query sessions for status reconciliation — skipping');
      return;
    }

    if (sessions.length === 0) return;

    let reconciled = 0;
    for (const session of sessions) {
      try {
        await this.sessionRepo.updateStatus(session.id, session.tenantId, {
          status: 'DISCONNECTED',
          lastDisconnectedAt: new Date(),
        });
        reconciled += 1;
      } catch (err) {
        reconcilerLogger.warn({ err, sessionId: session.id }, 'Failed to reconcile session status');
      }
    }

    reconcilerLogger.info(
      { reconciled, total: sessions.length },
      'Sessions marked DISCONNECTED — no socket survives a restart and bootstrap is disabled',
    );
  }
}
