import type { IExtensionSessionRepository } from '../../domain/contracts/IExtensionSessionRepository';

export class RevokeExtensionSessionUseCase {
  constructor(private readonly sessionRepo: IExtensionSessionRepository) {}

  async execute(sessionId: string): Promise<void> {
    await this.sessionRepo.revoke(sessionId);
  }

  async executeAllForUser(userId: string): Promise<number> {
    return this.sessionRepo.revokeAllForUser(userId);
  }
}
