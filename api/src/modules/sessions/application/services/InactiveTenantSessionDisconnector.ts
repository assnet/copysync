import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { logger } from '../../../../shared/logger/logger';

export type InactiveTenantDisconnectReason = 'TENANT_SUSPENDED' | 'TENANT_NOT_ACTIVE';

export interface InactiveTenantSessionDisconnectorDeps {
  sessions: Pick<ISessionRepository, 'updateStatus' | 'markDisconnectedUnlessLeasedElsewhere'>;
  engine: Pick<IMessagingEngine, 'disconnectSession'>;
  audit: IAuditLogRepository;
  leaseRelease?: { execute(sessionId: string): Promise<void> };
  /**
   * Processo dono (`worker`/`all`, OWN-04): só grava/desconecta sessão com lease vivo deste
   * processo ou sem dono vivo (filtro no UPDATE). Ausente (`http`): todas, e a engine remota leva o
   * `disconnect` ao dono.
   */
  ownerWorkerId?: string;
}

const log = logger.child({ module: 'InactiveTenantSessionDisconnector' });

/**
 * Desconexão de sessão de tenant não `ACTIVE`, usada pelo listener de suspensão e pela varredura
 * por processo. Status (com limpeza do pedido, LEASE-08) antes da engine; release do lease depois
 * (LEASE-05). Sessão já em andamento neste processo é ignorada (listener × varredura não duplicam).
 */
export class InactiveTenantSessionDisconnector {
  private readonly inFlight = new Set<string>();

  constructor(private readonly deps: InactiveTenantSessionDisconnectorDeps) {}

  /** Devolve se desconectou. Lança só falha da gravação do status ou da engine (quem chama loga). */
  async disconnect(sessionId: string, tenantId: string, reason: InactiveTenantDisconnectReason): Promise<boolean> {
    if (this.inFlight.has(sessionId)) return false;
    this.inFlight.add(sessionId);
    try {
      const { sessions, engine, audit, leaseRelease, ownerWorkerId } = this.deps;
      if (ownerWorkerId) {
        const marked = await sessions.markDisconnectedUnlessLeasedElsewhere(sessionId, tenantId, ownerWorkerId);
        if (!marked) {
          log.debug({ sessionId, tenantId }, 'sessão com lease vivo de outro processo; fica com o dono');
          return false;
        }
      } else {
        await sessions.updateStatus(sessionId, tenantId, {
          status: 'DISCONNECTED',
          lastDisconnectedAt: new Date(),
          clearConnectRequest: true,
        });
      }
      try {
        await engine.disconnectSession({ sessionId, tenantId });
      } finally {
        // Nunca lança; só solta lease deste processo.
        await leaseRelease?.execute(sessionId);
      }
      await audit.create({
        tenantId,
        action: 'SESSION_DISCONNECTED',
        meta: { sessionId, reason, actor: 'SYSTEM' },
      });
      return true;
    } finally {
      this.inFlight.delete(sessionId);
    }
  }
}
