import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { ISessionAuthStateRepository } from '../../domain/contracts/ISessionAuthStateRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { IMessagingEngine } from '../../../../modules/messaging/domain/contracts/IMessagingEngine';
import { SessionNotFoundError } from '../../../../shared/errors/internal/SessionErrors';

export interface DeleteSessionInput {
  sessionId: string;
  tenantId: string;
  userId: string;
}

/**
 * Soft-deletes a session.
 * - Disconnects/logouts from the engine if still active.
 * - Removes auth state from DB.
 * - Marks the session as deleted (soft delete).
 */
export class DeleteSessionUseCase {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly authStateRepo: ISessionAuthStateRepository,
    private readonly auditRepo: IAuditLogRepository,
    private readonly engine: IMessagingEngine,
  ) {}

  async execute(input: DeleteSessionInput): Promise<void> {
    const session = await this.sessionRepo.findById(input.sessionId, input.tenantId);
    if (!session) throw new SessionNotFoundError(input.sessionId);

    // Gracefully disconnect from engine if the session is active
    const activeStatuses = ['CONNECTED', 'CONNECTING', 'AWAITING_QR', 'AWAITING_PAIRING'];
    if (activeStatuses.includes(session.status)) {
      try {
        await this.engine.disconnectSession({ sessionId: input.sessionId, tenantId: input.tenantId });
      } catch {
        // Best-effort — proceed with deletion even if engine fails
      }
    }

    // Remove stored credentials
    await this.authStateRepo.deleteBySessionId(input.sessionId);

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
