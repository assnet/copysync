import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IMessagingEngine } from '../../../../modules/messaging/domain/contracts/IMessagingEngine';
import { SessionNotFoundError } from '../../../../shared/errors/internal/SessionErrors';

export interface GetSessionPairingCodeInput {
  sessionId: string;
  tenantId: string;
}

export interface GetSessionPairingCodeOutput {
  sessionId: string;
  pairingCode: string | null;
}

export class GetSessionPairingCodeUseCase {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly engine: IMessagingEngine,
  ) {}

  async execute(input: GetSessionPairingCodeInput): Promise<GetSessionPairingCodeOutput> {
    const session = await this.sessionRepo.findById(input.sessionId, input.tenantId);
    if (!session) throw new SessionNotFoundError(input.sessionId);

    const pairingCode = await this.engine.getSessionPairingCode(input.sessionId);
    return { sessionId: input.sessionId, pairingCode };
  }
}
