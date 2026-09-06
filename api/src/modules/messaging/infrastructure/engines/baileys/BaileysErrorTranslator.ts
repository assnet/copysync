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
  /**
   * Whether the persisted credentials are definitively dead and must be wiped so
   * the session can be paired again (new QR).  Only true when WhatsApp itself
   * invalidated the device — never for transport-level or concurrency failures,
   * where the credentials are still valid and wiping them would force a pointless
   * re-pairing.
   */
  shouldClearCredentials: boolean;
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
      shouldClearCredentials: false,
      error: new RecoverableConnectionError('non-boom disconnect'),
    };
  }

  const reason = lastError.output?.statusCode as DisconnectReason | undefined;

  switch (reason) {
    // ── Credentials revoked by WhatsApp — only a new pairing recovers the session ──
    case DisconnectReason.loggedOut:
    case DisconnectReason.forbidden:
    case DisconnectReason.badSession:
      return {
        shouldReconnect: false,
        shouldClearCredentials: true,
        error: new SessionExpiredError(sessionId),
      };

    case DisconnectReason.multideviceMismatch:
      return {
        shouldReconnect: false,
        shouldClearCredentials: true,
        error: new PairingFailedError('multi-device mismatch'),
      };

    case DisconnectReason.connectionReplaced:
      // Another socket took over this device (WhatsApp opened elsewhere, or a
      // duplicated socket on our side).  Credentials remain valid — never wipe them.
      return {
        shouldReconnect: false,
        shouldClearCredentials: false,
        error: new SessionExpiredError(sessionId),
      };

    case DisconnectReason.restartRequired:
      return {
        shouldReconnect: true,
        shouldClearCredentials: false,
        error: new RecoverableConnectionError('restart required'),
      };

    case DisconnectReason.connectionLost:
    case DisconnectReason.connectionClosed:
    case DisconnectReason.timedOut:
      return {
        shouldReconnect: true,
        shouldClearCredentials: false,
        error: new RecoverableConnectionError(`disconnect reason ${reason}`),
      };

    case DisconnectReason.unavailableService:
      return {
        shouldReconnect: true,
        shouldClearCredentials: false,
        error: new EngineTemporarilyUnavailableError(),
      };

    default:
      return {
        shouldReconnect: true,
        shouldClearCredentials: false,
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
