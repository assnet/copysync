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
