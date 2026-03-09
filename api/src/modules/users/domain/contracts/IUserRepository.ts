import type { User } from '../entities/User';

export interface UserTenantMembership {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  role: string;
}

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByTenant(tenantId: string): Promise<User[]>;
  findTenantsForUser(userId: string): Promise<UserTenantMembership[]>;
  create(user: User): Promise<User>;
  update(user: User): Promise<User>;
}
