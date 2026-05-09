import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';
import type { IAuthRepository } from '../../domain/contracts/IAuthRepository';
import type { RefreshResultDto } from '../dtos/LoginResultDto';
import { TokenExpiredError, TokenInvalidError } from '../../../../shared/errors/internal/AuthErrors';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';

/**
 * Validates a refresh token from the DB and returns the user payload
 * needed for the controller to sign a new access token.
 */
export class RefreshTokenUseCase {
  constructor(
    private readonly authRepo: IAuthRepository,
    private readonly userRepo: IUserRepository,
  ) {}

  async execute(refreshToken: string): Promise<RefreshResultDto> {
    const stored = await this.authRepo.findRefreshToken(refreshToken);

    if (!stored) {
      throw new TokenInvalidError();
    }

    if (stored.revokedAt !== null) {
      throw new TokenInvalidError();
    }

    if (stored.expiresAt < new Date()) {
      throw new TokenExpiredError();
    }

    const user = await this.userRepo.findById(stored.userId);
    if (!user) {
      throw new NotFoundError('User', stored.userId);
    }

    return { userId: user.id, isSuperAdmin: user.isSuperAdmin };
  }
}
