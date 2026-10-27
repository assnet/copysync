import type { ExtensionInstallation as PrismaExtensionInstallation } from '@prisma/client';
import type { ExtensionInstallation } from '../../domain/entities/ExtensionInstallation';

export class PrismaExtensionInstallationMapper {
  static toDomain(raw: PrismaExtensionInstallation): ExtensionInstallation {
    return {
      installationId: raw.installationId,
      extensionId: raw.extensionId,
      channel: raw.channel,
      deviceId: raw.deviceId,
      userId: raw.userId,
      version: raw.version,
      status: raw.status,
      firstSeenAt: raw.firstSeenAt,
      installedAt: raw.installedAt,
      lastSeenAt: raw.lastSeenAt,
      lastHeartbeatAt: raw.lastHeartbeatAt,
      lastSiteSeenAt: raw.lastSiteSeenAt,
      uninstalledAt: raw.uninstalledAt,
      previousInstallationId: raw.previousInstallationId,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
