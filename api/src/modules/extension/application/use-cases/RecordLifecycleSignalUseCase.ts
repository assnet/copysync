import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma.client';
import type { IExtensionInstallationRepository } from '../../domain/contracts/IExtensionInstallationRepository';

export interface LifecycleSignalInput {
  installationId: string;
  type: string;
  version: string;
  channel: string;
  dedupeKey: string;
  userId?: string;
}

export class RecordLifecycleSignalUseCase {
  constructor(
    private readonly installationRepo: IExtensionInstallationRepository,
  ) {}

  async execute(input: LifecycleSignalInput): Promise<{ created: boolean }> {
    try {
      await prisma.extensionLifecycleEvent.create({
        data: {
          installationId: input.installationId,
          type: input.type,
          version: input.version,
          channel: input.channel,
          dedupeKey: input.dedupeKey,
          userId: input.userId,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { created: false };
      }
      throw err;
    }

    if (input.type === 'uninstall') {
      await this.installationRepo.updateStatus(input.installationId, 'UNINSTALLED');
    } else {
      await this.installationRepo.updateLastSeen(input.installationId, {
        lastSeenAt: new Date(),
        version: input.version,
      });
    }

    return { created: true };
  }
}
