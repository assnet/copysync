import crypto from 'node:crypto';
import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';
import type { IAuthRepository } from '../../domain/contracts/IAuthRepository';
import type { LoginInputDto } from '../dtos/LoginInputDto';
import type { LoginResultDto } from '../dtos/LoginResultDto';
import { InvalidCredentialsError } from '../../../../shared/errors/internal/AuthErrors';
import { verifyPassword } from '../../../../shared/utils/hash';
import { env } from '../../../../shared/config/env';

/**
 * Validates credentials, issues a refresh token and returns user + tenant data.
 * The access token (JWT) is signed by the controller — it's a presentation concern.
 */
export class LoginUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly authRepo: IAuthRepository,
  ) {}

  async execute(input: LoginInputDto): Promise<LoginResultDto> {
    const user = await this.userRepo.findByEmail(input.email);

    if (!user) {
      throw new InvalidCredentialsError();
    }

    const passwordValid = await verifyPassword(input.password, user.passwordHash);
    if (!passwordValid) {
      throw new InvalidCredentialsError();
    }

    const tenants = await this.userRepo.findTenantsForUser(user.id);

    const refreshToken = crypto.randomUUID();
    const refreshTokenExpiresAt = new Date(
      Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.authRepo.saveRefreshToken(user.id, refreshToken, refreshTokenExpiresAt);

    return {
      userId: user.id,
      isSuperAdmin: user.isSuperAdmin,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isSuperAdmin: user.isSuperAdmin,
      },
      tenants,
      refreshToken,
      refreshTokenExpiresAt,
    };
  }
}
