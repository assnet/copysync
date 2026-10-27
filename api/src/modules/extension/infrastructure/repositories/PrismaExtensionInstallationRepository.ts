import type { PrismaClient } from '@prisma/client';
import type {
  IExtensionInstallationRepository,
  UpsertExtensionInstallationInput,
} from '../../domain/contracts/IExtensionInstallationRepository';
import type { ExtensionInstallation, ExtensionInstallationStatus } from '../../domain/entities/ExtensionInstallation';
import { PrismaExtensionInstallationMapper } from '../mappers/PrismaExtensionInstallationMapper';

export class PrismaExtensionInstallationRepository implements IExtensionInstallationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(installationId: string): Promise<ExtensionInstallation | null> {
    const row = await this.prisma.extensionInstallation.findUnique({ where: { installationId } });
    return row ? PrismaExtensionInstallationMapper.toDomain(row) : null;
  }

  async findByDeviceAndExtension(deviceId: string, extensionId: string): Promise<ExtensionInstallation[]> {
    const rows = await this.prisma.extensionInstallation.findMany({
      where: { deviceId, extensionId },
      orderBy: { lastSeenAt: 'desc' },
    });
    return rows.map(PrismaExtensionInstallationMapper.toDomain);
  }

  async upsert(input: UpsertExtensionInstallationInput): Promise<ExtensionInstallation> {
    const row = await this.prisma.extensionInstallation.upsert({
      where: { installationId: input.installationId },
      create: {
        installationId: input.installationId,
        extensionId: input.extensionId,
        channel: input.channel,
        deviceId: input.deviceId ?? null,
        userId: input.userId ?? null,
        version: input.version,
      },
      update: {
        version: input.version,
        lastSeenAt: new Date(),
        ...(input.userId && { userId: input.userId }),
      },
    });
    return PrismaExtensionInstallationMapper.toDomain(row);
  }

  async updateStatus(installationId: string, status: ExtensionInstallationStatus): Promise<void> {
    const data: Record<string, unknown> = { status };
    if (status === 'UNINSTALLED') data.uninstalledAt = new Date();
    await this.prisma.extensionInstallation.update({ where: { installationId }, data });
  }

  async updateLastSeen(
    installationId: string,
    fields: { lastSeenAt?: Date; lastHeartbeatAt?: Date; lastSiteSeenAt?: Date; version?: string },
  ): Promise<void> {
    await this.prisma.extensionInstallation.update({ where: { installationId }, data: fields });
  }

  async markReplaced(installationId: string, replacedByInstallationId: string): Promise<void> {
    await this.prisma.extensionInstallation.update({
      where: { installationId },
      data: { status: 'REPLACED', previousInstallationId: replacedByInstallationId },
    });
  }
}
