/**
 * BaileysErrorTranslator
 *
 * Maps Baileys/WA-level errors and disconnect reasons to internal AppErrors.
 * Nothing outside infrastructure/engines/baileys should ever deal with raw Baileys errors.
 */
import { DisconnectReason } from '@whiskeysockets/baileys';
import { AppError } from '../../../../../shared/errors/AppError';
import {
  EngineNotReadyError,
  EngineTemporarilyUnavailableError,
  RecoverableConnectionError,
  PairingFailedError,
} from '../../../../../shared/errors/internal/MessagingErrors';
import {
  SessionExpiredError,
  SessionNotConnectedError,
} from '../../../../../shared/errors/internal/SessionErrors';

// Duck-typed Boom shape — avoids importing @hapi/boom as a direct dependency.
type BoomLike = { output: { statusCode: number } };

function isBoomLike(err: unknown): err is BoomLike {
  return (
    typeof err === 'object' &&
    err !== null &&
    'output' in err &&
    typeof (err as BoomLike).output?.statusCode === 'number'
  );
}

export type BaileysDisconnectInfo = {
  /** Whether the adapter should attempt automatic reconnect */
  shouldReconnect: boolean;
  /** Translated internal error */
  error: AppError;
};

/**
 * Translate a Baileys connection-close event into an internal error and
 * a reconnect decision.
 *
 * @param sessionId  - session being closed (for error messages)
 * @param lastError  - the `lastDisconnect.error` from Baileys connection.update
 */
export function translateDisconnect(
  sessionId: string,
  lastError: unknown,
): BaileysDisconnectInfo {
  if (!isBoomLike(lastError)) {
    return {
      shouldReconnect: true,
      error: new RecoverableConnectionError('non-boom disconnect'),
    };
  }

  const reason = lastError.output?.statusCode as DisconnectReason | undefined;

  switch (reason) {
    case DisconnectReason.loggedOut:
      return {
        shouldReconnect: false,
        error: new SessionExpiredError(sessionId),
      };

    case DisconnectReason.forbidden:
      return {
        shouldReconnect: false,
        error: new SessionExpiredError(sessionId),
      };

    case DisconnectReason.badSession:
      return {
        shouldReconnect: false,
        error: new SessionExpiredError(sessionId),
      };

    case DisconnectReason.connectionReplaced:
      // WhatsApp opened on another device — do not reconnect from here
      return {
        shouldReconnect: false,
        error: new SessionExpiredError(sessionId),
      };

    case DisconnectReason.restartRequired:
      return {
        shouldReconnect: true,
        error: new RecoverableConnectionError('restart required'),
      };

    case DisconnectReason.connectionLost:
    case DisconnectReason.connectionClosed:
    case DisconnectReason.timedOut:
      return {
        shouldReconnect: true,
        error: new RecoverableConnectionError(`disconnect reason ${reason}`),
      };

    case DisconnectReason.multideviceMismatch:
      return {
        shouldReconnect: false,
        error: new PairingFailedError('multi-device mismatch'),
      };

    case DisconnectReason.unavailableService:
      return {
        shouldReconnect: true,
        error: new EngineTemporarilyUnavailableError(),
      };

    default:
      return {
        shouldReconnect: true,
        error: new RecoverableConnectionError(`unknown reason ${reason ?? 'n/a'}`),
      };
  }
}

/**
 * Translate a generic error raised while calling a Baileys socket method.
 */
export function translateEngineError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (isBoomLike(err)) {
    const reason = err.output?.statusCode as DisconnectReason | undefined;
    if (reason === DisconnectReason.loggedOut) return new SessionExpiredError('unknown');
    return new EngineTemporarilyUnavailableError();
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('not open') || msg.includes('not connected')) {
      return new SessionNotConnectedError('unknown');
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return new RecoverableConnectionError(err.message);
    }
    return new EngineNotReadyError();
  }

  return new EngineNotReadyError();
}
