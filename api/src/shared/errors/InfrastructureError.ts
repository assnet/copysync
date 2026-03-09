import { AppError } from './AppError';

/**
 * Errors from infrastructure concerns (DB, external services).
 * Default HTTP status: 503 Service Unavailable.
 */
export class InfrastructureError extends AppError {
  constructor(code: string, message: string, meta?: Record<string, unknown>) {
    super(code, message, 503, meta);
  }
}
