import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { IMessagingEngine } from '../../../../modules/messaging/domain/contracts/IMessagingEngine';
import type { SessionStatus } from '../../domain/enums/SessionStatus';
import type { ReleaseSessionLeaseUseCase } from './ReleaseSessionLeaseUseCase';
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
    private readonly leaseRelease?: Pick<ReleaseSessionLeaseUseCase, 'execute'>,
  ) {}

  async execute(input: DisconnectSessionInput): Promise<DisconnectSessionOutput> {
    const session = await this.sessionRepo.findById(input.sessionId, input.tenantId);
    if (!session) throw new SessionNotFoundError(input.sessionId);

    if (!session.canDisconnect()) {
      throw new InvalidSessionStateError(input.sessionId, session.status);
    }

    // Status + fim do pedido de conexão antes da engine (LEASE-08): nenhum worker readota no meio
    await this.sessionRepo.updateStatus(input.sessionId, input.tenantId, {
      status: 'DISCONNECTED',
      lastDisconnectedAt: new Date(),
      clearConnectRequest: true,
    });

    await this.engine.disconnectSession({ sessionId: input.sessionId, tenantId: input.tenantId });

    // Socket fechado: solta o lease deste worker (LEASE-05)
    await this.leaseRelease?.execute(input.sessionId);

    await this.auditRepo.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'SESSION_DISCONNECTED',
      meta: { sessionId: input.sessionId },
    });

    return { sessionId: input.sessionId, status: 'DISCONNECTED' };
  }
}
