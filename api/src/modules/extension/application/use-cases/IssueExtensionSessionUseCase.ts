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
import type { IExtensionLifecycleRepository } from '../../domain/contracts/IExtensionLifecycleRepository';
import {
  HUB_LIFECYCLE_ENVELOPE_TYPE,
  LIFECYCLE_EVENT,
  STORE_CLICK_ATTRIBUTION_WINDOW_MS,
} from '../../domain/lifecycleEvents';
import { buildLifecycleOutboxPayload } from '../../domain/services/lifecycleOutboxPayload';

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
    private readonly entitlementReader: Pick<IExtensionEntitlementReader, 'hasMarketplaceExtension'>,
    private readonly lifecycleRepo: IExtensionLifecycleRepository | null = null,
    private readonly now: () => Date = () => new Date(),
    private readonly onLifecycleError: (err: unknown) => void = () => {},
  ) {}

  async execute(input: IssueExtensionSessionInput): Promise<IssueExtensionSessionResult> {
    const allowed = await this.entitlementReader.hasMarketplaceExtension(input.mlTenantId);
    if (!allowed) {
      throw new ExtensionNotEntitledError();
    }

    const previous = await this.installationRepo.findById(input.installationId);
    const linkedNow = previous?.userId !== input.userId;

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
      // Re-vínculo (inclusive a outro tenant) nunca herda o consentimento Shein: o painel pede de novo.
      sheinConsentAt: null,
      expiresAt,
      absoluteExpiresAt,
    });

    if (linkedNow && this.lifecycleRepo) {
      // Telemetria nunca derruba o vínculo.
      await this.recordLinked(input, now).catch(this.onLifecycleError);
    }

    return { session, rawToken };
  }

  /**
   * LINKED: instalação passa a ter este usuário como dono. Atribui o STORE_CLICK mais recente do
   * usuário ainda sem instalação (até 7 dias) — é assim que clique → instalação → usuário se ligam.
   */
  private async recordLinked(input: IssueExtensionSessionInput, now: Date): Promise<void> {
    const repo = this.lifecycleRepo!;
    const storeClick = await repo.attributeStoreClick(
      input.userId, input.installationId, new Date(now.getTime() - STORE_CLICK_ATTRIBUTION_WINDOW_MS),
    );
    const clientKey = await repo.findClientKeyForTenant(input.mlTenantId);
    await repo.record({
      event: {
        installationId: input.installationId, type: LIFECYCLE_EVENT.LINKED, version: input.extVersion,
        channel: input.channel, dedupeKey: `LINKED:${input.userId}`, occurredAt: now,
        userId: input.userId, tenantId: input.mlTenantId,
      },
      outbox: clientKey
        ? {
            type: HUB_LIFECYCLE_ENVELOPE_TYPE,
            payload: buildLifecycleOutboxPayload({
              event: LIFECYCLE_EVENT.LINKED, occurredAt: now, installationId: input.installationId, clientKey,
              version: input.extVersion, channel: input.channel, storeClick,
            }),
          }
        : null,
    });
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
