import { prisma } from '../../../shared/database/prisma.client';
import { PrismaExtensionSessionRepository } from './repositories/PrismaExtensionSessionRepository';
import { PrismaExtensionInstallationRepository } from './repositories/PrismaExtensionInstallationRepository';

let _sessionRepo: PrismaExtensionSessionRepository | null = null;
let _installationRepo: PrismaExtensionInstallationRepository | null = null;

export const extensionContainer = {
  get sessionRepository(): PrismaExtensionSessionRepository {
    return (_sessionRepo ??= new PrismaExtensionSessionRepository(prisma));
  },
  get installationRepository(): PrismaExtensionInstallationRepository {
    return (_installationRepo ??= new PrismaExtensionInstallationRepository(prisma));
  },
};
