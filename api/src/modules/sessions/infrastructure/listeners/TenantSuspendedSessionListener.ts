import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import type { InternalTeamEvent } from '../../../../shared/events/InternalTeamEvent';
import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { logger } from '../../../../shared/logger/logger';
import type { ReleaseSessionLeaseUseCase } from '../../application/use-cases/ReleaseSessionLeaseUseCase';

const log = logger.child({ module: 'TenantSuspendedSessionListener' });

export function registerTenantSuspendedSessionListener(
  sessionRepo: ISessionRepository,
  engine: IMessagingEngine,
  auditRepo: IAuditLogRepository,
  leaseRelease?: Pick<ReleaseSessionLeaseUseCase, 'execute'>,
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
            // LEASE-08: status + limpeza do pedido antes da engine, para a adoção não reabrir.
            await sessionRepo.updateStatus(session.id, event.tenantId, {
              status: 'DISCONNECTED',
              lastDisconnectedAt: new Date(),
              clearConnectRequest: true,
            });
            try {
              await engine.disconnectSession({ sessionId: session.id, tenantId: event.tenantId });
            } finally {
              // LEASE-05: solta o lease depois de tentar fechar o socket; nunca lança.
              await leaseRelease?.execute(session.id);
            }
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
