export interface IAuthRepository {
  saveRefreshToken(userId: string, token: string, expiresAt: Date): Promise<void>;
  findRefreshToken(
    token: string,
  ): Promise<{ userId: string; expiresAt: Date; revokedAt: Date | null } | null>;
  revokeRefreshToken(token: string): Promise<void>;
  revokeAllUserTokens(userId: string): Promise<void>;
}
