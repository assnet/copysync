import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { SessionStatus } from '../../domain/enums/SessionStatus';
import {
  SessionNotFoundError,
  InvalidSessionStateError,
} from '../../../../shared/errors/internal/SessionErrors';

export interface DisconnectSessionInput {
  sessionId: string;
  tenantId: string;
  userId: string;
}

export interface DisconnectSessionOutput {
  sessionId: string;
  status: SessionStatus;
}

export class DisconnectSessionUseCase {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly auditRepo: IAuditLogRepository,
  ) {}

  async execute(input: DisconnectSessionInput): Promise<DisconnectSessionOutput> {
    const session = await this.sessionRepo.findById(input.sessionId, input.tenantId);
    if (!session) throw new SessionNotFoundError(input.sessionId);

    if (!session.canDisconnect()) {
      throw new InvalidSessionStateError(input.sessionId, session.status);
    }

    await this.sessionRepo.updateStatus(input.sessionId, input.tenantId, {
      status: 'DISCONNECTED',
      lastDisconnectedAt: new Date(),
    });

    await this.auditRepo.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'SESSION_DISCONNECTED',
      meta: { sessionId: input.sessionId },
    });

    // TODO (next step): call IMessagingEngine.disconnectSession()
    return { sessionId: input.sessionId, status: 'DISCONNECTED' };
  }
}
