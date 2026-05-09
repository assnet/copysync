import type { IUserRepository, UserTenantMembership } from '../../../users/domain/contracts/IUserRepository';

export interface ListUserTenantsInput {
  userId: string;
}

export interface ListUserTenantsResult {
  tenants: UserTenantMembership[];
}

/**
 * Returns the list of tenants the authenticated user belongs to.
 * Used by GET /me and GET /tenants.
 */
export class ListUserTenantsUseCase {
  constructor(private readonly userRepo: IUserRepository) {}

  async execute(input: ListUserTenantsInput): Promise<ListUserTenantsResult> {
    const tenants = await this.userRepo.findTenantsForUser(input.userId);
    return { tenants };
  }
}
