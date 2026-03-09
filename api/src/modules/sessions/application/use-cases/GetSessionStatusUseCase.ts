import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { SessionStatus } from '../../domain/enums/SessionStatus';
import { SessionNotFoundError } from '../../../../shared/errors/internal/SessionErrors';

export interface GetSessionStatusInput {
  sessionId: string;
  tenantId: string;
}

export interface GetSessionStatusOutput {
  sessionId: string;
  status: SessionStatus;
  phone: string | null;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
}

export class GetSessionStatusUseCase {
  constructor(private readonly sessionRepo: ISessionRepository) {}

  async execute(input: GetSessionStatusInput): Promise<GetSessionStatusOutput> {
    const session = await this.sessionRepo.findById(input.sessionId, input.tenantId);
    if (!session) throw new SessionNotFoundError(input.sessionId);

    return {
      sessionId: session.id,
      status: session.status,
      phone: session.phone,
      lastConnectedAt: session.lastConnectedAt,
      lastDisconnectedAt: session.lastDisconnectedAt,
    };
  }
}
