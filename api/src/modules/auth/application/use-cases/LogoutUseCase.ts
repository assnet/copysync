import type { IAuthRepository } from '../../domain/contracts/IAuthRepository';

/**
 * Revokes the provided refresh token, invalidating the session.
 */
export class LogoutUseCase {
  constructor(private readonly authRepo: IAuthRepository) {}

  async execute(refreshToken: string): Promise<void> {
    await this.authRepo.revokeRefreshToken(refreshToken);
  }
}
