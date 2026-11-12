import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import type { InternalTeamEvent } from '../../../../shared/events/InternalTeamEvent';
import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import { logger } from '../../../../shared/logger/logger';
import type { InactiveTenantSessionDisconnector } from '../../application/services/InactiveTenantSessionDisconnector';

const log = logger.child({ module: 'TenantSuspendedSessionListener' });

/**
 * Tenant suspenso: desconecta as sessões ativas dele. O filtro de dono (OWN-04) fica no
 * `disconnector`: em `worker`/`all` só sessões deste processo ou sem dono vivo (as de outro
 * processo saem pela varredura dele); no `http` todas, via engine remota.
 */
export function registerTenantSuspendedSessionListener(
  sessionRepo: Pick<ISessionRepository, 'findAllByTenant'>,
  disconnector: Pick<InactiveTenantSessionDisconnector, 'disconnect'>,
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
            await disconnector.disconnect(session.id, event.tenantId, 'TENANT_SUSPENDED');
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
