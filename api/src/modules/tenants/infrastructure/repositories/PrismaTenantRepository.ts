import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaTenantMapper } from '../mappers/PrismaTenantMapper';
import type { ITenantRepository } from '../../domain/contracts/ITenantRepository';
import type { Tenant } from '../../domain/entities/Tenant';

export class PrismaTenantRepository implements ITenantRepository {
  async findById(id: string): Promise<Tenant | null> {
    const raw = await prisma.tenant.findUnique({ where: { id } });
    return raw ? PrismaTenantMapper.toDomain(raw) : null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const raw = await prisma.tenant.findUnique({ where: { slug } });
    return raw ? PrismaTenantMapper.toDomain(raw) : null;
  }

  async listAll(): Promise<Tenant[]> {
    const rows = await prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(PrismaTenantMapper.toDomain);
  }

  async create(tenant: Tenant): Promise<Tenant> {
    const raw = await prisma.tenant.create({
      data: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
      },
    });
    return PrismaTenantMapper.toDomain(raw);
  }

  async update(tenant: Tenant): Promise<Tenant> {
    const raw = await prisma.tenant.update({
      where: { id: tenant.id },
      data: { name: tenant.name, status: tenant.status },
    });
    return PrismaTenantMapper.toDomain(raw);
  }
}
