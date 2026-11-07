export interface LoginInputDto {
  email: string;
  password: string;
  /** Token do widget Turnstile (exigido só em LOGIN_GUARD_MODE=enforce com secret). */
  turnstileToken?: string;
}

/** Origem da requisição, para a proteção do login. IP resolvido por `resolveClientIp`. */
export interface LoginRequestContext {
  ip: string | null;
  userAgent: string | null;
}
