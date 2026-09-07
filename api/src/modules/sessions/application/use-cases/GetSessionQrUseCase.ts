import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IMessagingEngine } from '../../../../modules/messaging/domain/contracts/IMessagingEngine';
import { SessionNotFoundError } from '../../../../shared/errors/internal/SessionErrors';

export interface GetSessionQrInput {
  sessionId: string;
  tenantId: string;
}

export interface GetSessionQrOutput {
  sessionId: string;
  qrCode: string | null;
}

export class GetSessionQrUseCase {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly engine: IMessagingEngine,
  ) {}

  async execute(input: GetSessionQrInput): Promise<GetSessionQrOutput> {
    const session = await this.sessionRepo.findById(input.sessionId, input.tenantId);
    if (!session) throw new SessionNotFoundError(input.sessionId);

    const qrCode = await this.engine.getSessionQr(input.sessionId);
    return { sessionId: input.sessionId, qrCode };
  }
}
