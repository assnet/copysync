import type { LoginResultDto } from '../../application/dtos/LoginResultDto';
import type { UserTenantMembership } from '../../../users/domain/contracts/IUserRepository';

export class AuthPresenter {
  /**
   * Transforms the LoginUseCase result + signed accessToken into the HTTP response body.
   */
  static toLoginResponse(result: LoginResultDto, accessToken: string) {
    return {
      accessToken,
      refreshToken: result.refreshToken,
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        isSuperAdmin: result.user.isSuperAdmin,
      },
      tenants: result.tenants.map(AuthPresenter.toTenantItem),
    };
  }

  static toRefreshResponse(accessToken: string) {
    return { accessToken };
  }

  private static toTenantItem(t: UserTenantMembership) {
    return {
      id: t.tenantId,
      name: t.tenantName,
      slug: t.tenantSlug,
      role: t.role,
    };
  }
}
