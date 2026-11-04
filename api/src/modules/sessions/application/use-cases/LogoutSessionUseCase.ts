import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { ISessionAuthStateRepository } from '../../domain/contracts/ISessionAuthStateRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { IMessagingEngine } from '../../../../modules/messaging/domain/contracts/IMessagingEngine';
import type { SessionStatus } from '../../domain/enums/SessionStatus';
import type { ReleaseSessionLeaseUseCase } from './ReleaseSessionLeaseUseCase';
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
    private readonly leaseRelease?: Pick<ReleaseSessionLeaseUseCase, 'execute'>,
  ) {}

  async execute(input: LogoutSessionInput): Promise<LogoutSessionOutput> {
    const session = await this.sessionRepo.findById(input.sessionId, input.tenantId);
    if (!session) throw new SessionNotFoundError(input.sessionId);

    // Status + fim do pedido de conexão antes da engine (LEASE-08)
    await this.sessionRepo.updateStatus(input.sessionId, input.tenantId, {
      status: 'LOGGED_OUT',
      lastDisconnectedAt: new Date(),
      clearConnectRequest: true,
    });

    // Engine sends WA logout packet and closes socket
    await this.engine.logoutSession({ sessionId: input.sessionId, tenantId: input.tenantId });

    // Socket fechado: solta o lease deste worker (LEASE-05)
    await this.leaseRelease?.execute(input.sessionId);

    // Invalidate credentials but keep session_auth_states row — same sessionId keeps chat + media links
    await this.authStateRepo.clearCredentials(input.sessionId);

    await this.auditRepo.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'SESSION_LOGGED_OUT',
      meta: { sessionId: input.sessionId },
    });

    return { sessionId: input.sessionId, status: 'LOGGED_OUT' };
  }
}
