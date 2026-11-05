import type { Tenant } from '../../domain/entities/Tenant';
import type { ITenantRepository } from '../../domain/contracts/ITenantRepository';
import type { IEntitlementSnapshotReader } from '../../domain/contracts/IEntitlementSnapshotReader';
import type { ITenantUsageReader } from '../../domain/contracts/ITenantUsageReader';
import { buildSubscriptionLimits } from '../../domain/services/subscriptionLimits';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import type { GetTenantSubscriptionOutput } from '../dtos/TenantSubscriptionDto';

/**
 * Vencimento da assinatura. `subscriptionExpiresAt` entra no `Tenant` pela T1 (SUB-03); até lá o
 * campo opcional mantém o contrato (`expiresAt: null`) sem quebrar a compilação.
 */
type TenantWithExpiry = Tenant & { subscriptionExpiresAt?: Date | null };

/** Plano, status, vencimento e uso × limite do tenant (`GET /subscription`, SUB-01/04). */
export class GetTenantSubscriptionUseCase {
  constructor(
    private readonly tenantRepo: ITenantRepository,
    private readonly entitlements: IEntitlementSnapshotReader,
    private readonly usage: ITenantUsageReader,
  ) {}

  async execute(tenantId: string): Promise<GetTenantSubscriptionOutput> {
    const [found, values, usage] = await Promise.all([
      this.tenantRepo.findById(tenantId),
      this.entitlements.readAll(tenantId),
      this.usage.read(tenantId),
    ]);
    if (!found) throw new NotFoundError('Tenant');
    const tenant: TenantWithExpiry = found;

    return {
      tenantName: tenant.name,
      planSlug: tenant.planSlug,
      status: tenant.status,
      suspendedAt: tenant.suspendedAt,
      expiresAt: tenant.subscriptionExpiresAt ?? null,
      limits: buildSubscriptionLimits(values, usage),
    };
  }
}
