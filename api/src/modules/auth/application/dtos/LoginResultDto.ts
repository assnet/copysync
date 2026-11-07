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

/** Passo de código por e-mail: o ticket identifica o desafio; o código nunca volta na resposta. */
export interface LoginCodeChallengeDto {
  ticket: string;
  /** false = havia um código válido enviado há pouco; o usuário digita esse. */
  codeSent: boolean;
  codeExpiresAt: Date | null;
  resendAvailableAt: Date;
}

export type LoginOutcomeDto =
  | { kind: 'SESSION'; result: LoginResultDto }
  | { kind: 'CODE_REQUIRED'; challenge: LoginCodeChallengeDto };
