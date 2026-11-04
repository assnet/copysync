/**
 * Traduz erros da lib (RPCError) para erros internos. Só este arquivo e o adapter importam `telegram`.
 */
import { FloodWaitError, RPCError } from 'telegram/errors';
import {
  TelegramCodeExpiredError,
  TelegramCodeInvalidError,
  TelegramFloodWaitError,
  TelegramPasswordInvalidError,
  TelegramPhoneInvalidError,
} from '../../../../../shared/errors/internal/TelegramErrors';
import { AppError } from '../../../../../shared/errors/AppError';
import { PairingFailedError, RecoverableConnectionError } from '../../../../../shared/errors/internal/MessagingErrors';

/** Erros que significam "a conta saiu desta sessão": credenciais devem ser apagadas. */
const LOGGED_OUT_CODES = new Set(['AUTH_KEY_UNREGISTERED', 'SESSION_REVOKED', 'USER_DEACTIVATED', 'AUTH_KEY_INVALID', 'SESSION_EXPIRED']);

export function isLoggedOutError(err: unknown): boolean {
  return err instanceof RPCError && LOGGED_OUT_CODES.has(err.errorMessage);
}

export function isAuthCancel(err: unknown): boolean {
  return err instanceof Error && err.message === 'AUTH_USER_CANCEL';
}

export function translateTelegramLoginError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof FloodWaitError) return new TelegramFloodWaitError(err.seconds);
  if (err instanceof RPCError) {
    switch (err.errorMessage) {
      case 'PHONE_NUMBER_INVALID':
      case 'PHONE_NUMBER_BANNED':
      case 'PHONE_NUMBER_FLOOD':
      case 'PHONE_NUMBER_UNOCCUPIED':
        return new TelegramPhoneInvalidError();
      case 'PHONE_CODE_INVALID':
      case 'PHONE_CODE_EMPTY':
        return new TelegramCodeInvalidError();
      case 'PHONE_CODE_EXPIRED':
        return new TelegramCodeExpiredError();
      case 'PASSWORD_HASH_INVALID':
      case 'SRP_PASSWORD_CHANGED':
        return new TelegramPasswordInvalidError();
      default:
        return new PairingFailedError(err.errorMessage);
    }
  }
  if (isAuthCancel(err)) return new PairingFailedError('cancelled');
  return new RecoverableConnectionError(err instanceof Error ? err.message : 'unknown');
}

export function translateTelegramSendError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof FloodWaitError) return new TelegramFloodWaitError(err.seconds);
  return new RecoverableConnectionError(err instanceof RPCError ? err.errorMessage : err instanceof Error ? err.message : 'unknown');
}
