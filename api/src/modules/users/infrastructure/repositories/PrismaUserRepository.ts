import { prisma } from '../../../../shared/database/prisma.client';
import type { TransactionClient } from '../../../../shared/database/UnitOfWork';
import { PrismaUserMapper } from '../mappers/PrismaUserMapper';
import type { IUserRepository, UserTenantMembership } from '../../domain/contracts/IUserRepository';
import type { User } from '../../domain/entities/User';

export class PrismaUserRepository implements IUserRepository {
  private readonly db: TransactionClient;
  constructor(db?: TransactionClient) { this.db = db ?? prisma; }

  async findById(id: string): Promise<User | null> {
    const raw = await this.db.user.findUnique({ where: { id } });
    return raw ? PrismaUserMapper.toDomain(raw) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const raw = await this.db.user.findUnique({ where: { email } });
    return raw ? PrismaUserMapper.toDomain(raw) : null;
  }

  async findByTenant(tenantId: string): Promise<User[]> {
    const rows = await this.db.userTenant.findMany({
      where: { tenantId },
      include: { user: true },
    });
    return rows.map((r) => PrismaUserMapper.toDomain(r.user));
  }

  async findTenantsForUser(userId: string): Promise<UserTenantMembership[]> {
    const rows = await this.db.userTenant.findMany({
      where: { userId },
      include: { tenant: { select: { name: true, slug: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((r) => ({
      tenantId: r.tenantId,
      tenantName: r.tenant.name,
      tenantSlug: r.tenant.slug,
      tenantStatus: r.tenant.status,
      role: r.role,
    }));
  }

  async create(user: User): Promise<User> {
    const raw = await this.db.user.create({
      data: {
        id: user.id,
        email: user.email,
        passwordHash: user.passwordHash,
        passwordSetAt: user.passwordSetAt,
        mustChangePassword: user.mustChangePassword,
        name: user.name,
        isSuperAdmin: user.isSuperAdmin,
      },
    });
    return PrismaUserMapper.toDomain(raw);
  }

  async update(user: User): Promise<User> {
    const raw = await this.db.user.update({
      where: { id: user.id },
      data: {
        name: user.name,
        passwordHash: user.passwordHash,
        passwordSetAt: user.passwordSetAt,
        mustChangePassword: user.mustChangePassword,
      },
    });
    return PrismaUserMapper.toDomain(raw);
  }

  async createUserTenant(input: { userId: string; tenantId: string; role: string }): Promise<void> {
    await this.db.userTenant.create({
      data: { userId: input.userId, tenantId: input.tenantId, role: input.role as any },
    });
  }
}
