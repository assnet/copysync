import { randomBytes } from 'crypto';
import type { IExtensionSessionRepository } from '../../domain/contracts/IExtensionSessionRepository';
import type { IExtensionInstallationRepository } from '../../domain/contracts/IExtensionInstallationRepository';
import type { IExtensionEntitlementReader } from '../../domain/contracts/IExtensionEntitlementReader';
import { hashToken } from '../../domain/services/tokenHash';
import {
  EXT_SESSION_TTL_SECONDS,
  EXT_SESSION_ABSOLUTE_TTL_SECONDS,
} from '../../domain/constants';
import type { ExtensionSession } from '../../domain/entities/ExtensionSession';

export interface IssueExtensionSessionInput {
  userId: string;
  mlTenantId: string;
  installationId: string;
  deviceId?: string;
  extVersion: string;
  extensionId: string;
  channel: string;
  mlSessionConsent: boolean;
}

export interface IssueExtensionSessionResult {
  session: ExtensionSession;
  rawToken: string;
}

export class IssueExtensionSessionUseCase {
  constructor(
    private readonly sessionRepo: IExtensionSessionRepository,
    private readonly installationRepo: IExtensionInstallationRepository,
    private readonly entitlementReader: IExtensionEntitlementReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: IssueExtensionSessionInput): Promise<IssueExtensionSessionResult> {
    const allowed = await this.entitlementReader.hasMarketplaceExtension(input.mlTenantId);
    if (!allowed) {
      throw new ExtensionNotEntitledError();
    }

    await this.installationRepo.upsert({
      installationId: input.installationId,
      extensionId: input.extensionId,
      channel: input.channel,
      deviceId: input.deviceId,
      userId: input.userId,
      version: input.extVersion,
    });

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(rawToken);
    const now = this.now();
    const expiresAt = new Date(now.getTime() + EXT_SESSION_TTL_SECONDS * 1000);
    const absoluteExpiresAt = new Date(now.getTime() + EXT_SESSION_ABSOLUTE_TTL_SECONDS * 1000);

    const session = await this.sessionRepo.issue({
      userId: input.userId,
      installationId: input.installationId,
      mlTenantId: input.mlTenantId,
      tokenHash,
      extVersion: input.extVersion,
      mlConsentAt: input.mlSessionConsent ? now : null,
      expiresAt,
      absoluteExpiresAt,
    });

    return { session, rawToken };
  }
}

export class ExtensionNotEntitledError extends Error {
  readonly code = 'EXTENSION_NOT_ENTITLED';
  readonly statusCode = 403;
  constructor() {
    super('Marketplace extension is not available on the current plan');
    this.name = 'ExtensionNotEntitledError';
  }
}
