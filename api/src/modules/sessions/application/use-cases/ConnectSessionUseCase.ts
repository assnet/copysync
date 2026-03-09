import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { IMessagingEngine } from '../../../../modules/messaging/domain/contracts/IMessagingEngine';
import type { SessionStatus } from '../../domain/enums/SessionStatus';
import {
  SessionNotFoundError,
  InvalidSessionStateError,
} from '../../../../shared/errors/internal/SessionErrors';

export interface ConnectSessionInput {
  sessionId: string;
  tenantId: string;
  userId: string;
}

export interface ConnectSessionOutput {
  sessionId: string;
  status: SessionStatus;
  qrCode?: string;
  pairingCode?: string;
}

export class ConnectSessionUseCase {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly auditRepo: IAuditLogRepository,
    private readonly engine: IMessagingEngine,
  ) {}

  async execute(input: ConnectSessionInput): Promise<ConnectSessionOutput> {
    const session = await this.sessionRepo.findById(input.sessionId, input.tenantId);
    if (!session) throw new SessionNotFoundError(input.sessionId);

    if (!session.canConnect()) {
      throw new InvalidSessionStateError(input.sessionId, session.status);
    }

    // Update DB to CONNECTING before starting engine (so any crash doesn't leave PENDING)
    await this.sessionRepo.updateStatus(input.sessionId, input.tenantId, { status: 'CONNECTING' });

    await this.auditRepo.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'SESSION_CONNECTED',
      meta: { sessionId: input.sessionId, action: 'connect_requested' },
    });

    // Initiate real connection — QR/status arrive asynchronously via InternalEventBus
    await this.engine.connectSession({ sessionId: input.sessionId, tenantId: input.tenantId });

    return { sessionId: input.sessionId, status: 'CONNECTING' };
  }
}
