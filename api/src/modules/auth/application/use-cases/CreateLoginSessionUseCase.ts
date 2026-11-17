import crypto from 'node:crypto';
import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';
import type { IAuthRepository } from '../../domain/contracts/IAuthRepository';
import type { LoginResultDto } from '../dtos/LoginResultDto';
import { env } from '../../../../shared/config/env';
import type { IProductAccessReader } from '../../../tenants/domain/contracts/IProductAccessReader';
import { attachTenantProducts } from '../../../tenants/application/services/attachTenantProducts';

export interface LoginSessionUser {
  id: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
}

/**
 * Emite o refresh token e monta o resultado do login (usuário + tenants) depois que a identidade
 * foi provada: senha (login limpo) ou senha + código por e-mail. O access token é assinado na rota.
 */
export class CreateLoginSessionUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly authRepo: IAuthRepository,
    /** Opcional: `products` na resposta do login. O painel usa `GET /tenants`; falha aqui não barra o login. */
    private readonly productAccess?: () => Pick<IProductAccessReader, 'list'>,
  ) {}

  async execute(user: LoginSessionUser): Promise<LoginResultDto> {
    const tenants = await this.withProducts(await this.userRepo.findTenantsForUser(user.id));
    const refreshToken = crypto.randomUUID();
    const refreshTokenExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.authRepo.saveRefreshToken(user.id, refreshToken, refreshTokenExpiresAt);
    return {
      userId: user.id,
      isSuperAdmin: user.isSuperAdmin,
      user: { id: user.id, name: user.name, email: user.email, isSuperAdmin: user.isSuperAdmin },
      tenants,
      refreshToken,
      refreshTokenExpiresAt,
    };
  }

  private async withProducts(memberships: LoginResultDto['tenants']): Promise<LoginResultDto['tenants']> {
    if (!this.productAccess) return memberships;
    try {
      return await attachTenantProducts(memberships, this.productAccess());
    } catch {
      return memberships;
    }
  }
}
