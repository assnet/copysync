import { AppError } from './AppError';

/**
 * Errors originating from business/domain rules.
 * Default HTTP status: 422 Unprocessable Entity.
 */
export class DomainError extends AppError {
  constructor(code: string, message: string, meta?: Record<string, unknown>) {
    super(code, message, 422, meta);
  }
}
