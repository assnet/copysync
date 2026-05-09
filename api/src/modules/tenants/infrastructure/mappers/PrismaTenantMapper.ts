import type { Tenant as PrismaTenant } from '@prisma/client';
import { Tenant, type TenantStatus } from '../../domain/entities/Tenant';

export class PrismaTenantMapper {
  static toDomain(raw: PrismaTenant): Tenant {
    return new Tenant({
      id: raw.id,
      name: raw.name,
      slug: raw.slug,
      status: raw.status as TenantStatus,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }
}
