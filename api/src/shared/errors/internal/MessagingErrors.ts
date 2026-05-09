import { AppError } from '../AppError';

// ── Messaging / engine errors ─────────────────────────────────────────────────

export class MessageSendFailedError extends AppError {
  constructor(reason: string) {
    super('MESSAGE_SEND_FAILED', `Message send failed: ${reason}`, 502);
  }
}

export class EngineNotReadyError extends AppError {
  constructor() {
    super('ENGINE_NOT_READY', 'Messaging engine is not ready', 503);
  }
}

export class EngineTemporarilyUnavailableError extends AppError {
  constructor() {
    super('ENGINE_TEMPORARILY_UNAVAILABLE', 'Messaging engine temporarily unavailable', 503);
  }
}

export class RecoverableConnectionError extends AppError {
  constructor(reason: string) {
    super('RECOVERABLE_CONNECTION_ERROR', `Recoverable connection error: ${reason}`, 503);
  }
}

export class PairingFailedError extends AppError {
  constructor(reason: string) {
    super('PAIRING_FAILED', `Pairing failed: ${reason}`, 400);
  }
}
