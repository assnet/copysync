import { prisma } from '../../../../shared/database/prisma.client';
import type { IAuthRepository } from '../../domain/contracts/IAuthRepository';

export class PrismaAuthRepository implements IAuthRepository {
  async saveRefreshToken(userId: string, token: string, expiresAt: Date): Promise<void> {
    await prisma.refreshToken.create({
      data: { userId, token, expiresAt },
    });
  }

  async findRefreshToken(
    token: string,
  ): Promise<{ userId: string; expiresAt: Date; revokedAt: Date | null } | null> {
    const raw = await prisma.refreshToken.findUnique({ where: { token } });
    if (!raw) return null;
    return { userId: raw.userId, expiresAt: raw.expiresAt, revokedAt: raw.revokedAt };
  }

  async revokeRefreshToken(token: string): Promise<void> {
    await prisma.refreshToken.update({
      where: { token },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
