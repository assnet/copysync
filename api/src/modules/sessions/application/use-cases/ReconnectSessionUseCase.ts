import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { IMessagingEngine } from '../../../../modules/messaging/domain/contracts/IMessagingEngine';
import type { ConnectSessionOutput } from './ConnectSessionUseCase';
import {
  SessionNotFoundError,
  InvalidSessionStateError,
  SessionLeaseHeldError,
} from '../../../../shared/errors/internal/SessionErrors';
import { markConnectRequested } from '../services/markConnectRequested';

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

    await markConnectRequested(this.sessionRepo, input.sessionId, input.tenantId);

    await this.sessionRepo.updateStatus(input.sessionId, input.tenantId, { status: 'CONNECTING' });

    await this.auditRepo.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'SESSION_CONNECTED',
      meta: { sessionId: input.sessionId, action: 'reconnect_requested' },
    });

    try {
      await this.engine.reconnectSession({ sessionId: input.sessionId, tenantId: input.tenantId });
    } catch (err) {
      // Lease de outro processo: o status é do dono; desfaz o CONNECTING e o 503 sobe
      if (err instanceof SessionLeaseHeldError) {
        await this.sessionRepo
          .updateStatus(input.sessionId, input.tenantId, { status: session.status })
          .catch(() => undefined);
      }
      throw err;
    }

    return { sessionId: input.sessionId, status: 'CONNECTING' };
  }
}
