import type { PrismaClient } from '@prisma/client';
import type { ISaverTeamReader, SaverTeamMember } from '../../domain/contracts/ISaverTeamReader';

/** Membros do tenant lidos de `user_tenants` + `users`, sempre por `tenantId`. */
export class PrismaSaverTeamReader implements ISaverTeamReader {
  constructor(private readonly prisma: PrismaClient) {}

  async listMembers(tenantId: string): Promise<SaverTeamMember[]> {
    const rows = await this.prisma.userTenant.findMany({
      where: { tenantId },
      select: { userId: true, role: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ userId: r.userId, role: r.role, name: r.user.name, email: r.user.email }));
  }

  async findMember(tenantId: string, userId: string): Promise<SaverTeamMember | null> {
    const r = await this.prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      select: { userId: true, role: true, user: { select: { name: true, email: true } } },
    });
    return r ? { userId: r.userId, role: r.role, name: r.user.name, email: r.user.email } : null;
  }
}
