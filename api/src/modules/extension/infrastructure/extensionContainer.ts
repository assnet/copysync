import { prisma } from '../../../shared/database/prisma.client';
import { PrismaExtensionSessionRepository } from './repositories/PrismaExtensionSessionRepository';
import { PrismaExtensionInstallationRepository } from './repositories/PrismaExtensionInstallationRepository';
import { PrismaHubOutboxRepository } from './repositories/PrismaHubOutboxRepository';

let _sessionRepo: PrismaExtensionSessionRepository | null = null;
let _installationRepo: PrismaExtensionInstallationRepository | null = null;
let _outboxRepo: PrismaHubOutboxRepository | null = null;

export const extensionContainer = {
  get sessionRepository(): PrismaExtensionSessionRepository {
    return (_sessionRepo ??= new PrismaExtensionSessionRepository(prisma));
  },
  get installationRepository(): PrismaExtensionInstallationRepository {
    return (_installationRepo ??= new PrismaExtensionInstallationRepository(prisma));
  },
  get outboxRepository(): PrismaHubOutboxRepository {
    return (_outboxRepo ??= new PrismaHubOutboxRepository(prisma));
  },
};
