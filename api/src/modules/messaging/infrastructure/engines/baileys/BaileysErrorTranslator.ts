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
  MessageSendFailedError,
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
  /**
   * Another client with the same credentials took the session over (440). Only
   * our own API can hold these credentials, so the taker is another instance of
   * it (deploy overlap, local run against the same database). The taker owns the
   * session and its status from now on; the losing socket must not write status.
   */
  takenOverByAnotherInstance: boolean;
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
      takenOverByAnotherInstance: false,
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
        takenOverByAnotherInstance: false,
        error: new SessionExpiredError(sessionId),
      };

    case DisconnectReason.multideviceMismatch:
      return {
        shouldReconnect: false,
        shouldClearCredentials: true,
        takenOverByAnotherInstance: false,
        error: new PairingFailedError('multi-device mismatch'),
      };

    case DisconnectReason.connectionReplaced:
      // Another socket with these same credentials took the device over — only another
      // instance of this API can do that. Credentials remain valid — never wipe them —
      // and the status in the database now belongs to the instance that took over.
      return {
        shouldReconnect: false,
        shouldClearCredentials: false,
        takenOverByAnotherInstance: true,
        error: new SessionExpiredError(sessionId),
      };

    case DisconnectReason.restartRequired:
      return {
        shouldReconnect: true,
        shouldClearCredentials: false,
      takenOverByAnotherInstance: false,
        error: new RecoverableConnectionError('restart required'),
      };

    case DisconnectReason.connectionLost:
    case DisconnectReason.connectionClosed:
    case DisconnectReason.timedOut:
      return {
        shouldReconnect: true,
        shouldClearCredentials: false,
      takenOverByAnotherInstance: false,
        error: new RecoverableConnectionError(`disconnect reason ${reason}`),
      };

    case DisconnectReason.unavailableService:
      return {
        shouldReconnect: true,
        shouldClearCredentials: false,
      takenOverByAnotherInstance: false,
        error: new EngineTemporarilyUnavailableError(),
      };

    default:
      return {
        shouldReconnect: true,
        shouldClearCredentials: false,
      takenOverByAnotherInstance: false,
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

/**
 * Traduz a falha de um envio pontual (ex.: reação).
 *
 * Sessão fora do ar ou expirada mantém o erro de sessão; qualquer outra falha vira
 * MESSAGE_SEND_FAILED. A mensagem crua da lib não sobe — só o código.
 */
export function translateSendError(err: unknown, reason: string): AppError {
  const translated = translateEngineError(err);
  if (
    err instanceof AppError
    || translated instanceof SessionNotConnectedError
    || translated instanceof SessionExpiredError
  ) {
    return translated;
  }
  return new MessageSendFailedError(reason);
}
