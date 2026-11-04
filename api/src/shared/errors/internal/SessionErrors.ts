import { AppError } from '../AppError';
import { EngineTemporarilyUnavailableError } from './MessagingErrors';

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

/** Número de WhatsApp fora do formato brasileiro aceito (DDD + número, com ou sem 55). */
export class SessionPhoneInvalidError extends AppError {
  constructor(field: 'declaredPhone' | 'phone' = 'declaredPhone') {
    super('SESSION_PHONE_INVALID', 'Invalid WhatsApp phone number', 422, { field });
  }
}

/**
 * Lease da sessão com outro processo vivo (LEASE-03, D5): o socket não abre aqui.
 * Mesmo código/HTTP de `EngineTemporarilyUnavailableError` (sem i18n novo), distinguível por `instanceof`.
 */
export class SessionLeaseHeldError extends EngineTemporarilyUnavailableError {
  constructor(public readonly sessionId: string) {
    super();
  }
}

/**
 * Worker recebeu chamada de sessão que não está nele (WROLE-09). Interno: só atravessa o fio
 * worker → http, onde o adapter remoto re-resolve o dono; nunca é resposta HTTP.
 */
export class SessionNotOwnedError extends AppError {
  constructor(public readonly sessionId: string) {
    super('SESSION_NOT_OWNED', `Session is not owned by this process: ${sessionId}`, 409);
  }
}
