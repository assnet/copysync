import { AppError } from '../AppError';

// ── Session errors ───────────────────────────────────────────────────────────

export class SessionNotFoundError extends AppError {
  constructor(sessionId: string) {
    super('SESSION_NOT_FOUND', `Session not found: ${sessionId}`, 404);
  }
}

export class SessionAlreadyConnectedError extends AppError {
  constructor(sessionId: string) {
    super('SESSION_ALREADY_CONNECTED', `Session is already connected: ${sessionId}`, 409);
  }
}

export class SessionNotConnectedError extends AppError {
  constructor(sessionId: string) {
    super('SESSION_NOT_CONNECTED', `Session is not connected: ${sessionId}`, 409);
  }
}

export class SessionExpiredError extends AppError {
  constructor(sessionId: string) {
    super('SESSION_EXPIRED', `Session expired: ${sessionId}`, 401);
  }
}

export class InvalidSessionStateError extends AppError {
  constructor(sessionId: string, currentState: string) {
    super(
      'INVALID_SESSION_STATE',
      `Invalid state '${currentState}' for session: ${sessionId}`,
      422,
    );
  }
}
