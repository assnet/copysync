import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { ISessionAuthStateRepository } from '../../domain/contracts/ISessionAuthStateRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { IMessagingEngine } from '../../../../modules/messaging/domain/contracts/IMessagingEngine';
import type { SessionStatus } from '../../domain/enums/SessionStatus';
import { SessionNotFoundError } from '../../../../shared/errors/internal/SessionErrors';

export interface LogoutSessionInput {
  sessionId: string;
  tenantId: string;
  userId: string;
}

export interface LogoutSessionOutput {
  sessionId: string;
  status: SessionStatus;
}

export class LogoutSessionUseCase {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly authStateRepo: ISessionAuthStateRepository,
    private readonly auditRepo: IAuditLogRepository,
    private readonly engine: IMessagingEngine,
  ) {}

  async execute(input: LogoutSessionInput): Promise<LogoutSessionOutput> {
    const session = await this.sessionRepo.findById(input.sessionId, input.tenantId);
    if (!session) throw new SessionNotFoundError(input.sessionId);

    // Engine sends WA logout packet and closes socket
    await this.engine.logoutSession({ sessionId: input.sessionId, tenantId: input.tenantId });

    // Clear credentials from DB — next connect will need fresh QR/pairing
    await this.authStateRepo.deleteBySessionId(input.sessionId);

    await this.sessionRepo.updateStatus(input.sessionId, input.tenantId, {
      status: 'LOGGED_OUT',
      lastDisconnectedAt: new Date(),
    });

    await this.auditRepo.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'SESSION_LOGGED_OUT',
      meta: { sessionId: input.sessionId },
    });

    return { sessionId: input.sessionId, status: 'LOGGED_OUT' };
  }
}
