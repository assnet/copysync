import type { PrismaClient } from '@prisma/client';
import type {
  IExtensionSessionRepository,
  CreateExtensionSessionInput,
} from '../../domain/contracts/IExtensionSessionRepository';
import type { ExtensionSession } from '../../domain/entities/ExtensionSession';
import { PrismaExtensionSessionMapper } from '../mappers/PrismaExtensionSessionMapper';

export class PrismaExtensionSessionRepository implements IExtensionSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByTokenHash(tokenHash: string): Promise<ExtensionSession | null> {
    const row = await this.prisma.extensionSession.findUnique({ where: { tokenHash } });
    return row ? PrismaExtensionSessionMapper.toDomain(row) : null;
  }

  async findByPrevTokenHash(prevTokenHash: string): Promise<ExtensionSession | null> {
    const row = await this.prisma.extensionSession.findFirst({ where: { prevTokenHash } });
    return row ? PrismaExtensionSessionMapper.toDomain(row) : null;
  }

  async findByUserAndInstallation(userId: string, installationId: string): Promise<ExtensionSession | null> {
    const row = await this.prisma.extensionSession.findUnique({
      where: { userId_installationId: { userId, installationId } },
    });
    return row ? PrismaExtensionSessionMapper.toDomain(row) : null;
  }

  async findActiveByUserId(userId: string): Promise<ExtensionSession[]> {
    const rows = await this.prisma.extensionSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(PrismaExtensionSessionMapper.toDomain);
  }

  async create(input: CreateExtensionSessionInput): Promise<ExtensionSession> {
    const row = await this.prisma.extensionSession.create({ data: input });
    return PrismaExtensionSessionMapper.toDomain(row);
  }

  async rotateToken(id: string, newTokenHash: string, newExpiresAt: Date, graceUntil: Date): Promise<ExtensionSession> {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.extensionSession.findUniqueOrThrow({ where: { id } });
      return tx.extensionSession.update({
        where: { id },
        data: {
          prevTokenHash: current.tokenHash,
          prevValidUntil: graceUntil,
          tokenHash: newTokenHash,
          expiresAt: newExpiresAt,
          lastSeenAt: new Date(),
        },
      });
    });
    return PrismaExtensionSessionMapper.toDomain(row);
  }

  async slideExpiration(id: string, newExpiresAt: Date): Promise<void> {
    await this.prisma.extensionSession.update({
      where: { id },
      data: { expiresAt: newExpiresAt, lastSeenAt: new Date() },
    });
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.extensionSession.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.extensionSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async deleteExpiredBefore(date: Date): Promise<number> {
    const result = await this.prisma.extensionSession.deleteMany({
      where: { absoluteExpiresAt: { lt: date } },
    });
    return result.count;
  }
}
