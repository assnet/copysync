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
