import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { IMessagingEngine } from '../../../../modules/messaging/domain/contracts/IMessagingEngine';
import type { ConnectSessionOutput } from './ConnectSessionUseCase';
import {
  SessionNotFoundError,
  InvalidSessionStateError,
} from '../../../../shared/errors/internal/SessionErrors';

export interface ReconnectSessionInput {
  sessionId: string;
  tenantId: string;
  userId: string;
}

export type ReconnectSessionOutput = ConnectSessionOutput;

export class ReconnectSessionUseCase {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly auditRepo: IAuditLogRepository,
    private readonly engine: IMessagingEngine,
  ) {}

  async execute(input: ReconnectSessionInput): Promise<ReconnectSessionOutput> {
    const session = await this.sessionRepo.findById(input.sessionId, input.tenantId);
    if (!session) throw new SessionNotFoundError(input.sessionId);

    if (!session.canReconnect()) {
      throw new InvalidSessionStateError(input.sessionId, session.status);
    }

    await this.sessionRepo.updateStatus(input.sessionId, input.tenantId, { status: 'CONNECTING' });

    await this.auditRepo.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'SESSION_CONNECTED',
      meta: { sessionId: input.sessionId, action: 'reconnect_requested' },
    });

    await this.engine.reconnectSession({ sessionId: input.sessionId, tenantId: input.tenantId });

    return { sessionId: input.sessionId, status: 'CONNECTING' };
  }
}
