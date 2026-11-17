import type { IUserRepository, UserTenantMembership } from '../../../users/domain/contracts/IUserRepository';
import type { IProductAccessReader } from '../../domain/contracts/IProductAccessReader';
import { attachTenantProducts, type WithProducts } from '../services/attachTenantProducts';

export interface ListUserTenantsInput {
  userId: string;
}

export interface ListUserTenantsResult {
  tenants: WithProducts<UserTenantMembership>[];
}

/**
 * Returns the list of tenants the authenticated user belongs to, each with its `products`
 * (docs/acesso-por-produto.md). Used by GET /me and GET /tenants.
 */
export class ListUserTenantsUseCase {
  constructor(
    private readonly userRepo: Pick<IUserRepository, 'findTenantsForUser'>,
    private readonly productAccess: () => Pick<IProductAccessReader, 'list'>,
  ) {}

  async execute(input: ListUserTenantsInput): Promise<ListUserTenantsResult> {
    const memberships = await this.userRepo.findTenantsForUser(input.userId);
    return { tenants: await attachTenantProducts(memberships, this.productAccess()) };
  }
}
