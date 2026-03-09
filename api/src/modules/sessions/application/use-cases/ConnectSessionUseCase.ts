import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
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
  /** Reserved: will be populated when engine is integrated. */
  qrCode?: string;
  pairingCode?: string;
}

export class ConnectSessionUseCase {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly auditRepo: IAuditLogRepository,
  ) {}

  async execute(input: ConnectSessionInput): Promise<ConnectSessionOutput> {
    const session = await this.sessionRepo.findById(input.sessionId, input.tenantId);
    if (!session) throw new SessionNotFoundError(input.sessionId);

    if (!session.canConnect()) {
      throw new InvalidSessionStateError(input.sessionId, session.status);
    }

    await this.sessionRepo.updateStatus(input.sessionId, input.tenantId, {
      status: 'CONNECTING',
    });

    await this.auditRepo.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'SESSION_CONNECTED',
      meta: { sessionId: input.sessionId, action: 'connect_requested' },
    });

    // TODO (next step): call IMessagingEngine.connectSession() → return QR/pairingCode
    return { sessionId: input.sessionId, status: 'CONNECTING' };
  }
}
