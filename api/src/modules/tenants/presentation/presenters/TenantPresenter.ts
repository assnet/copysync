import type { UserTenantMembership } from '../../../users/domain/contracts/IUserRepository';
import type { SwitchTenantResult } from '../../application/use-cases/SwitchTenantUseCase';

export class TenantPresenter {
  static toTenantItem(membership: UserTenantMembership) {
    return {
      id: membership.tenantId,
      name: membership.tenantName,
      slug: membership.tenantSlug,
      status: membership.tenantStatus,
      role: membership.role,
    };
  }

  static toTenantList(memberships: UserTenantMembership[]) {
    return {
      tenants: memberships.map(TenantPresenter.toTenantItem),
    };
  }

  static toSwitchResult(result: SwitchTenantResult) {
    return {
      tenantId: result.tenantId,
      tenantName: result.tenantName,
      tenantSlug: result.tenantSlug,
      role: result.role,
    };
  }
}
