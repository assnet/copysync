import { prisma } from '../../../../shared/database/prisma.client';
import type { TransactionClient } from '../../../../shared/database/UnitOfWork';
import { PrismaTenantMapper } from '../mappers/PrismaTenantMapper';
import type { ITenantRepository } from '../../domain/contracts/ITenantRepository';
import type { Tenant } from '../../domain/entities/Tenant';

export class PrismaTenantRepository implements ITenantRepository {
  private readonly db: TransactionClient;
  constructor(db?: TransactionClient) { this.db = db ?? prisma; }

  async findById(id: string): Promise<Tenant | null> {
    const raw = await this.db.tenant.findUnique({ where: { id } });
    return raw ? PrismaTenantMapper.toDomain(raw) : null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const raw = await this.db.tenant.findUnique({ where: { slug } });
    return raw ? PrismaTenantMapper.toDomain(raw) : null;
  }

  async listAll(): Promise<Tenant[]> {
    const rows = await this.db.tenant.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(PrismaTenantMapper.toDomain);
  }

  async create(tenant: Tenant): Promise<Tenant> {
    const raw = await this.db.tenant.create({
      data: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        billingCustomerId: tenant.billingCustomerId,
        planSlug: tenant.planSlug,
        suspendedAt: tenant.suspendedAt,
      },
    });
    return PrismaTenantMapper.toDomain(raw);
  }

  async update(tenant: Tenant): Promise<Tenant> {
    const raw = await this.db.tenant.update({
      where: { id: tenant.id },
      data: {
        name: tenant.name,
        status: tenant.status,
        billingCustomerId: tenant.billingCustomerId,
        planSlug: tenant.planSlug,
        suspendedAt: tenant.suspendedAt,
      },
    });
    return PrismaTenantMapper.toDomain(raw);
  }

  async findByBillingCustomerId(billingCustomerId: string): Promise<Tenant | null> {
    const raw = await this.db.tenant.findUnique({ where: { billingCustomerId } });
    return raw ? PrismaTenantMapper.toDomain(raw) : null;
  }

  async updateStatus(id: string, status: Tenant['status'], suspendedAt: Date | null): Promise<Tenant> {
    const raw = await this.db.tenant.update({
      where: { id },
      data: { status, suspendedAt },
    });
    return PrismaTenantMapper.toDomain(raw);
  }

  async updateBillingSeq(id: string, seq: number): Promise<number> {
    const { count } = await this.db.tenant.updateMany({
      where: {
        id,
        OR: [
          { lastBillingEventSeq: null },
          { lastBillingEventSeq: { lt: seq } },
        ],
      },
      data: { lastBillingEventSeq: seq },
    });
    return count;
  }
}
