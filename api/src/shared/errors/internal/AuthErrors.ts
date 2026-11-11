import { AppError } from '../AppError';

// ── Auth errors ───────────────────────────────────────────────────────────────

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, 403);
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    super('INVALID_CREDENTIALS', 'Invalid email or password', 401);
  }
}

export class TokenExpiredError extends AppError {
  constructor() {
    super('TOKEN_EXPIRED', 'Token has expired', 401);
  }
}

export class TokenInvalidError extends AppError {
  constructor() {
    super('TOKEN_INVALID', 'Token is invalid', 401);
  }
}

export class PasswordMismatchError extends AppError {
  constructor() {
    super('PASSWORD_MISMATCH', 'As senhas não coincidem', 400);
  }
}

export class WeakPasswordError extends AppError {
  constructor(failures: string[]) {
    super(
      'WEAK_PASSWORD',
      `Senha não atende requisitos: ${failures.join(', ')}`,
      400,
      { requirements: failures },
    );
  }
}

// ── Proteção do login (docs/seguranca-login.md) ───────────────────────────────
// Mensagens genéricas: nenhuma revela se o e-mail existe. O painel traduz pelo `code`.

export class LoginTooManyAttemptsError extends AppError {
  constructor(retryAt: Date) {
    super('LOGIN_TOO_MANY_ATTEMPTS', 'Too many attempts. Try again later.', 429, { retryAt: retryAt.toISOString() });
  }
}

export class LoginCaptchaRequiredError extends AppError {
  constructor() {
    super('LOGIN_CAPTCHA_REQUIRED', 'Complete the verification to continue.', 403);
  }
}

export class LoginCaptchaInvalidError extends AppError {
  constructor() {
    super('LOGIN_CAPTCHA_INVALID', 'The verification failed or expired. Try again.', 403);
  }
}

export class LoginCodeSendLimitError extends AppError {
  constructor(retryAt: Date) {
    super('LOGIN_CODE_SEND_LIMIT', 'Wait before requesting a new code.', 429, { retryAt: retryAt.toISOString() });
  }
}

export class LoginCodeDeliveryFailedError extends AppError {
  constructor() {
    super('LOGIN_CODE_DELIVERY_FAILED', 'Could not send the code. Try again.', 503);
  }
}

export class LoginCodeInvalidError extends AppError {
  constructor(attemptsLeft: number) {
    super('LOGIN_CODE_INVALID', 'Invalid code.', 400, { attemptsLeft });
  }
}

export class LoginCodeExpiredError extends AppError {
  constructor() {
    super('LOGIN_CODE_EXPIRED', 'The code expired. Request a new one.', 400);
  }
}

export class LoginCodeExhaustedError extends AppError {
  constructor() {
    super('LOGIN_CODE_EXHAUSTED', 'Too many wrong codes. Request a new one.', 400);
  }
}

export class LoginTicketInvalidError extends AppError {
  constructor() {
    super('LOGIN_TICKET_INVALID', 'The verification step expired. Sign in again.', 400);
  }
}

// ── Recuperação de senha (docs/recuperacao-de-senha.md) ──────────────────────

export class PasswordResetTooManyRequestsError extends AppError {
  constructor(retryAt: Date) {
    super('PASSWORD_RESET_TOO_MANY_REQUESTS', 'Too many requests. Try again later.', 429, { retryAt: retryAt.toISOString() });
  }
}

/** Link inexistente, vencido ou já usado: resposta única (o caminho é pedir outro link). */
export class PasswordResetInvalidError extends AppError {
  constructor() {
    super('PASSWORD_RESET_INVALID', 'Reset link is invalid, expired or already used', 404);
  }
}
