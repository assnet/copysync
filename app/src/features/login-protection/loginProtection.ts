import { serverToLocal } from '@/services/serverClock';
import { fill, loginProtectionStrings as S } from './strings';

/** Passo do código devolvido pelo login suspeito (202 OTP_REQUIRED). Fica só em memória. */
export interface LoginCodeChallenge {
  ticket: string;
  codeSent: boolean;
  codeExpiresAt: string | null;
  resendAvailableAt: string;
}

export interface ApiErrorLike {
  status?: number;
  code?: string;
  meta?: Record<string, unknown>;
}

/** HH:MM local de um horário do servidor (corrige o relógio do computador via `serverToLocal`). */
export function formatServerClock(iso: string, locale = 'pt-BR'): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return serverToLocal(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** `retryAt` (ISO) do 429, se houver. */
export function retryAtOf(err: unknown): string | null {
  const v = (err as ApiErrorLike | null)?.meta?.retryAt;
  return typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
}

/** Mensagem da tela para um erro da API de login (sempre genérica quanto à existência do e-mail). */
export function loginErrorMessage(err: unknown): string {
  const e = (err ?? {}) as ApiErrorLike;
  const retryAt = retryAtOf(err);
  switch (e.code) {
    case 'INVALID_CREDENTIALS': return S.invalidCredentials;
    case 'LOGIN_TOO_MANY_ATTEMPTS': return fill(S.tooManyAttempts, { time: retryAt ? formatServerClock(retryAt) : '--:--' });
    case 'LOGIN_CAPTCHA_REQUIRED': return S.captchaRequired;
    case 'LOGIN_CAPTCHA_INVALID': return S.captchaInvalid;
    case 'LOGIN_CODE_SEND_LIMIT': return fill(S.codeSendLimit, { time: retryAt ? formatServerClock(retryAt) : '--:--' });
    case 'LOGIN_CODE_DELIVERY_FAILED': return S.codeDeliveryFailed;
    case 'LOGIN_CODE_INVALID': {
      const left = Number(e.meta?.attemptsLeft);
      return left === 1 ? S.codeInvalidOne : fill(S.codeInvalid, { left: Number.isFinite(left) ? left : '' });
    }
    case 'LOGIN_CODE_EXPIRED': return S.codeExpired;
    case 'LOGIN_CODE_EXHAUSTED': return S.codeExhausted;
    case 'LOGIN_TICKET_INVALID': return S.ticketInvalid;
    default: return S.genericError;
  }
}

/** Só dígitos, no máximo 6 (aceita colar "123 456" ou "123-456"). */
export const sanitizeCode = (raw: string): string => raw.replace(/\D/g, '').slice(0, 6);
