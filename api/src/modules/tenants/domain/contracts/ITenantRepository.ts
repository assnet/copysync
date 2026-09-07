import type { Tenant } from '../entities/Tenant';

export interface ITenantRepository {
  findById(id: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  listAll(): Promise<Tenant[]>;
  create(tenant: Tenant): Promise<Tenant>;
  update(tenant: Tenant): Promise<Tenant>;
}
