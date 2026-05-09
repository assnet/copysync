import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';
import { ForbiddenError } from '../../../../shared/errors/internal/AuthErrors';

export interface SwitchTenantInput {
  userId: string;
  targetTenantId: string;
}

export interface SwitchTenantResult {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: string;
}

/**
 * Validates that the user is a member of the target tenant and returns tenant info.
 * The client uses the returned tenantId to set the X-Tenant-Id header going forward.
 */
export class SwitchTenantUseCase {
  constructor(private readonly userRepo: IUserRepository) {}

  async execute(input: SwitchTenantInput): Promise<SwitchTenantResult> {
    const tenants = await this.userRepo.findTenantsForUser(input.userId);
    const membership = tenants.find((t) => t.tenantId === input.targetTenantId);

    if (!membership) {
      throw new ForbiddenError('You are not a member of this tenant');
    }

    if (membership.tenantStatus !== 'ACTIVE') {
      throw new ForbiddenError('Tenant is not active');
    }

    return {
      tenantId: membership.tenantId,
      tenantName: membership.tenantName,
      tenantSlug: membership.tenantSlug,
      role: membership.role,
    };
  }
}
