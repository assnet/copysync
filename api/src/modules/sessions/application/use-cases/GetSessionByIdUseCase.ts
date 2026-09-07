import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { Session } from '../../domain/entities/Session';
import { SessionNotFoundError } from '../../../../shared/errors/internal/SessionErrors';

export interface GetSessionByIdInput {
  sessionId: string;
  tenantId: string;
}

export class GetSessionByIdUseCase {
  constructor(private readonly sessionRepo: ISessionRepository) {}

  async execute(input: GetSessionByIdInput): Promise<Session> {
    const session = await this.sessionRepo.findById(input.sessionId, input.tenantId);
    if (!session) throw new SessionNotFoundError(input.sessionId);
    return session;
  }
}
