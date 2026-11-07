import type { LoginCodeChallengeDto, LoginResultDto } from '../../application/dtos/LoginResultDto';
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

  /** 202 do login suspeito: ticket do passo + prazos (o código nunca volta na resposta). */
  static toCodeChallengeResponse(c: LoginCodeChallengeDto) {
    return {
      status: 'OTP_REQUIRED' as const,
      ticket: c.ticket,
      codeSent: c.codeSent,
      codeExpiresAt: c.codeExpiresAt ? c.codeExpiresAt.toISOString() : null,
      resendAvailableAt: c.resendAvailableAt.toISOString(),
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
