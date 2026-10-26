import { prisma } from '../../../../shared/database/prisma.client';
import type { TransactionClient } from '../../../../shared/database/UnitOfWork';
import type { IUserInviteRepository, UserInviteData } from '../../domain/contracts/IUserInviteRepository';

export class PrismaUserInviteRepository implements IUserInviteRepository {
  private readonly db: TransactionClient;
  constructor(db?: TransactionClient) { this.db = db ?? prisma; }

  async create(data: Omit<UserInviteData, 'createdAt'>): Promise<UserInviteData> {
    const raw = await this.db.userInvite.create({
      data: {
        id: data.id,
        tenantId: data.tenantId,
        email: data.email,
        role: data.role as any,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        acceptedAt: data.acceptedAt,
        invitedById: data.invitedById,
      },
    });
    return this.toData(raw);
  }

  async findByTokenHash(tokenHash: string): Promise<UserInviteData | null> {
    const raw = await this.db.userInvite.findUnique({ where: { tokenHash } });
    return raw ? this.toData(raw) : null;
  }

  async findPendingByTenantAndEmail(tenantId: string, email: string): Promise<UserInviteData | null> {
    const raw = await this.db.userInvite.findFirst({
      where: {
        tenantId,
        email,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    return raw ? this.toData(raw) : null;
  }

  async markAccepted(id: string): Promise<void> {
    await this.db.userInvite.updateMany({
      where: { id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });
  }

  async expirePreviousInvites(tenantId: string, email: string): Promise<void> {
    await this.db.userInvite.updateMany({
      where: { tenantId, email, acceptedAt: null },
      data: { expiresAt: new Date() },
    });
  }

  async cleanupOldInvites(tenantId: string, email: string, retentionDays: number): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    await this.db.userInvite.deleteMany({
      where: { tenantId, email, expiresAt: { lt: cutoff } },
    });
  }

  private toData(raw: any): UserInviteData {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      email: raw.email,
      role: raw.role,
      tokenHash: raw.tokenHash,
      expiresAt: raw.expiresAt,
      acceptedAt: raw.acceptedAt,
      invitedById: raw.invitedById,
      createdAt: raw.createdAt,
    };
  }
}
