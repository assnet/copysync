import type { ExtensionSession as PrismaExtensionSession } from '@prisma/client';
import type { ExtensionSession } from '../../domain/entities/ExtensionSession';

export class PrismaExtensionSessionMapper {
  static toDomain(raw: PrismaExtensionSession): ExtensionSession {
    return {
      id: raw.id,
      tokenHash: raw.tokenHash,
      prevTokenHash: raw.prevTokenHash,
      prevValidUntil: raw.prevValidUntil,
      userId: raw.userId,
      installationId: raw.installationId,
      mlTenantId: raw.mlTenantId,
      extVersion: raw.extVersion,
      mlConsentAt: raw.mlConsentAt,
      lastSeenAt: raw.lastSeenAt,
      expiresAt: raw.expiresAt,
      absoluteExpiresAt: raw.absoluteExpiresAt,
      revokedAt: raw.revokedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
