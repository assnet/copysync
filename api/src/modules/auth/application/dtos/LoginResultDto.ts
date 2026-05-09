import type { UserTenantMembership } from '../../../users/domain/contracts/IUserRepository';

export interface LoginUserDto {
  id: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
}

/**
 * Output of LoginUseCase.
 * The access token is NOT included here — it is signed by the controller (presentation concern).
 */
export interface LoginResultDto {
  userId: string;
  isSuperAdmin: boolean;
  user: LoginUserDto;
  tenants: UserTenantMembership[];
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface RefreshResultDto {
  userId: string;
  isSuperAdmin: boolean;
}
