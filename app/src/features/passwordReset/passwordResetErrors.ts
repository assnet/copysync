import { formatServerClock, retryAtOf, type ApiErrorLike } from '@/features/login-protection/loginProtection';
import { fill, loginProtectionStrings as LP } from '@/features/login-protection/strings';
import { passwordResetStrings as S } from './strings';

export const isResetLinkInvalid = (err: unknown): boolean => {
  const e = (err ?? {}) as ApiErrorLike;
  return e.code === 'PASSWORD_RESET_INVALID' || e.status === 404;
};

/** Mensagem para um erro do pedido do link. Nunca usa o texto da API nem revela se o e-mail existe. */
export function requestErrorMessage(err: unknown): string {
  const retryAt = retryAtOf(err);
  switch ((err as ApiErrorLike | null)?.code) {
    case 'PASSWORD_RESET_TOO_MANY_REQUESTS':
      return fill(S.tooManyRequests, { time: retryAt ? formatServerClock(retryAt) : '--:--' });
    case 'LOGIN_CAPTCHA_REQUIRED': return LP.captchaRequired;
    case 'LOGIN_CAPTCHA_INVALID': return LP.captchaInvalid;
    default: return S.requestError;
  }
}

/** Mensagem para um erro ao salvar a nova senha (link inválido é tratado à parte, como estado da tela). */
export function resetErrorMessage(err: unknown): string {
  switch ((err as ApiErrorLike | null)?.code) {
    case 'WEAK_PASSWORD': return S.weakPassword;
    case 'PASSWORD_MISMATCH': return S.passwordMismatch;
    default: return S.resetError;
  }
}
