import type { Tenant } from '../entities/Tenant';

export interface ITenantRepository {
  findById(id: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  findByBillingCustomerId(billingCustomerId: string): Promise<Tenant | null>;
  listAll(): Promise<Tenant[]>;
  create(tenant: Tenant): Promise<Tenant>;
  update(tenant: Tenant): Promise<Tenant>;
  updateStatus(id: string, status: Tenant['status'], suspendedAt: Date | null): Promise<Tenant>;
  updateBillingSeq(id: string, seq: number): Promise<number>;
}
