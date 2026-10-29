import { AppError } from '../AppError';

// ── Resource errors ───────────────────────────────────────────────────────────

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const detail = id ? `: ${id}` : '';
    super('NOT_FOUND', `${resource} not found${detail}`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, meta);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string) {
    super('TOO_MANY_REQUESTS', message, 429);
  }
}

/**
 * Limite por rota do `@fastify/rate-limit` estourado (`perTenantRateLimit`). `retryAfterSeconds`
 * deixa o painel mostrar "aguarde" sem ler header.
 */
export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super('RATE_LIMITED', 'Too many requests, try again later', 429, { retryAfterSeconds });
  }
}
