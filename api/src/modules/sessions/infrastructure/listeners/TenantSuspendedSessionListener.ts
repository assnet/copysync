import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import type { InternalTeamEvent } from '../../../../shared/events/InternalTeamEvent';
import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { logger } from '../../../../shared/logger/logger';

const log = logger.child({ module: 'TenantSuspendedSessionListener' });

export function registerTenantSuspendedSessionListener(
  sessionRepo: ISessionRepository,
  engine: IMessagingEngine,
  auditRepo: IAuditLogRepository,
): void {
  internalEventBus.on<Extract<InternalTeamEvent, { type: 'TENANT_SUSPENDED' }>>(
    'TENANT_SUSPENDED',
    async (event) => {
      try {
        const sessions = await sessionRepo.findAllByTenant(event.tenantId);
        const active = sessions.filter((s) => s.canDisconnect());
        if (active.length === 0) return;

        log.info({ tenantId: event.tenantId, count: active.length }, 'Disconnecting sessions for suspended tenant');

        for (const session of active) {
          try {
            await engine.disconnectSession({ sessionId: session.id, tenantId: event.tenantId });
            await sessionRepo.updateStatus(session.id, event.tenantId, {
              status: 'DISCONNECTED',
              lastDisconnectedAt: new Date(),
            });
            await auditRepo.create({
              tenantId: event.tenantId,
              action: 'SESSION_DISCONNECTED',
              meta: { sessionId: session.id, reason: 'TENANT_SUSPENDED', actor: 'SYSTEM' },
            });
          } catch (err) {
            log.error({ err, sessionId: session.id }, 'Failed to disconnect session on tenant suspension');
          }
        }
      } catch (err) {
        log.error({ err, tenantId: event.tenantId }, 'TenantSuspendedSessionListener failed');
      }
    },
  );
}
