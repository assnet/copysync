import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { ISessionAuthStateRepository } from '../../domain/contracts/ISessionAuthStateRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { IMessagingEngine } from '../../../../modules/messaging/domain/contracts/IMessagingEngine';
import type { ReleaseSessionLeaseUseCase } from './ReleaseSessionLeaseUseCase';
import { SessionNotFoundError } from '../../../../shared/errors/internal/SessionErrors';

/** Recursos de outros módulos presos à sessão (ex.: rodízio de links → PAUSED). */
export interface SessionLinkedResources {
  pauseBySession(tenantId: string, sessionId: string): Promise<unknown>;
}

export interface DeleteSessionInput {
  sessionId: string;
  tenantId: string;
  userId: string;
}

/**
 * Soft-deletes a session.
 * - Clears the connect request, disconnects from the engine if still active, releases the lease.
 * - Removes auth state from DB.
 * - Pauses resources tied to the session (link rotations → PAUSED) before the soft delete.
 * - Marks the session as deleted (soft delete).
 */
export class DeleteSessionUseCase {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly authStateRepo: ISessionAuthStateRepository,
    private readonly auditRepo: IAuditLogRepository,
    private readonly engine: IMessagingEngine,
    private readonly linkedResources: SessionLinkedResources[] = [],
    private readonly leaseRelease?: Pick<ReleaseSessionLeaseUseCase, 'execute'>,
  ) {}

  async execute(input: DeleteSessionInput): Promise<void> {
    const session = await this.sessionRepo.findById(input.sessionId, input.tenantId);
    if (!session) throw new SessionNotFoundError(input.sessionId);

    // Gracefully disconnect from engine if the session is active
    const activeStatuses = ['CONNECTED', 'CONNECTING', 'AWAITING_QR', 'AWAITING_PAIRING', 'AWAITING_CODE', 'AWAITING_PASSWORD'];
    const active = activeStatuses.includes(session.status);

    // Fim do pedido de conexão antes de desconectar (LEASE-08): nenhum worker readota no meio
    await this.sessionRepo.updateStatus(input.sessionId, input.tenantId, {
      status: active ? 'DISCONNECTED' : session.status,
      ...(active ? { lastDisconnectedAt: new Date() } : {}),
      clearConnectRequest: true,
    });

    if (active) {
      try {
        await this.engine.disconnectSession({ sessionId: input.sessionId, tenantId: input.tenantId });
      } catch {
        // Best-effort — proceed with deletion even if engine fails
      }
    }

    // Solta o lease mesmo com falha da engine (LEASE-05); sem dono, a escrita condicional não muda nada
    await this.leaseRelease?.execute(input.sessionId);

    // Remove stored credentials
    await this.authStateRepo.deleteBySessionId(input.sessionId);

    // Rodízios da sessão param antes de a sessão sumir da lista (soft delete; FK Restrict não dispara)
    for (const r of this.linkedResources) await r.pauseBySession(input.tenantId, input.sessionId);

    // Soft-delete the session record
    await this.sessionRepo.softDelete(input.sessionId, input.tenantId);

    await this.auditRepo.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'SESSION_DELETED',
      meta: { sessionId: input.sessionId },
    });
  }
}
