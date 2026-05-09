import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { IMessagingEngine } from '../../../../modules/messaging/domain/contracts/IMessagingEngine';
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
    private readonly engine: IMessagingEngine,
  ) {}

  async execute(input: DisconnectSessionInput): Promise<DisconnectSessionOutput> {
    const session = await this.sessionRepo.findById(input.sessionId, input.tenantId);
    if (!session) throw new SessionNotFoundError(input.sessionId);

    if (!session.canDisconnect()) {
      throw new InvalidSessionStateError(input.sessionId, session.status);
    }

    // Engine closes the socket; adapter also updates DB — we update here for safety
    await this.engine.disconnectSession({ sessionId: input.sessionId, tenantId: input.tenantId });

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

    return { sessionId: input.sessionId, status: 'DISCONNECTED' };
  }
}
