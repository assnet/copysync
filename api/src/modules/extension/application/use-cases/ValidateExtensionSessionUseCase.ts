import type { IExtensionSessionRepository } from '../../domain/contracts/IExtensionSessionRepository';
import type { ExtensionSession } from '../../domain/entities/ExtensionSession';
import { EXT_SESSION_TTL_SECONDS } from '../../domain/constants';

export interface ValidatedSession {
  session: ExtensionSession;
  rotated: boolean;
}

export class ValidateExtensionSessionUseCase {
  constructor(
    private readonly sessionRepo: IExtensionSessionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(tokenHash: string): Promise<ValidatedSession | null> {
    const now = this.now();

    let session = await this.sessionRepo.findByTokenHash(tokenHash);
    let rotated = false;

    if (!session) {
      session = await this.sessionRepo.findByPrevTokenHash(tokenHash);
      if (!session) return null;
      if (!session.prevValidUntil || session.prevValidUntil < now) return null;
      rotated = true;
    }

    if (session.revokedAt) return null;
    if (session.expiresAt < now) return null;
    if (session.absoluteExpiresAt < now) return null;

    const newExpiry = new Date(now.getTime() + EXT_SESSION_TTL_SECONDS * 1000);
    const effectiveExpiry = newExpiry < session.absoluteExpiresAt ? newExpiry : session.absoluteExpiresAt;
    if (effectiveExpiry.getTime() > session.expiresAt.getTime() + 60_000) {
      await this.sessionRepo.slideExpiration(session.id, effectiveExpiry);
    }

    return { session, rotated };
  }
}
