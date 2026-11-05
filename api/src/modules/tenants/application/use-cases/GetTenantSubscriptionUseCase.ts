import type { ITenantRepository } from '../../domain/contracts/ITenantRepository';
import type { IEntitlementSnapshotReader } from '../../domain/contracts/IEntitlementSnapshotReader';
import type { ITenantUsageReader } from '../../domain/contracts/ITenantUsageReader';
import { buildSubscriptionLimits } from '../../domain/services/subscriptionLimits';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import type { GetTenantSubscriptionOutput } from '../dtos/TenantSubscriptionDto';

/** Plano, status, vencimento e uso × limite do tenant (`GET /subscription`, SUB-01/04). */
export class GetTenantSubscriptionUseCase {
  constructor(
    private readonly tenantRepo: ITenantRepository,
    private readonly entitlements: IEntitlementSnapshotReader,
    private readonly usage: ITenantUsageReader,
  ) {}

  async execute(tenantId: string): Promise<GetTenantSubscriptionOutput> {
    const [tenant, values, usage] = await Promise.all([
      this.tenantRepo.findById(tenantId),
      this.entitlements.readAll(tenantId),
      this.usage.read(tenantId),
    ]);
    if (!tenant) throw new NotFoundError('Tenant');

    return {
      tenantName: tenant.name,
      planSlug: tenant.planSlug,
      status: tenant.status,
      suspendedAt: tenant.suspendedAt,
      expiresAt: tenant.subscriptionExpiresAt,
      limits: buildSubscriptionLimits(values, usage),
    };
  }
}
