import { useCallback, useEffect, useState } from 'react';
import { sessionService } from '@/services/session.service';
import { serverNow } from '@/services/serverClock';
import { sessionStrings } from '../strings';
import { TELEGRAM_CODE_RESEND_MS } from '../utils';
import type { SessionConnection } from './useSessionConnection';

const t = sessionStrings.telegram.connect;

type ApiError = Error & { code?: string; status?: number; meta?: Record<string, unknown> };

export type TelegramLoginPhase = 'idle' | 'code' | 'password';

interface Window { startAt: number; endAt: number }

/** Mensagem por `error.code` da API; `null` = não é erro conhecido do Telegram. */
export function telegramErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case 'TELEGRAM_CODE_INVALID': return t.errors.codeInvalid;
    case 'TELEGRAM_CODE_EXPIRED': return t.errors.codeExpired;
    case 'TELEGRAM_PASSWORD_INVALID': return t.errors.passwordInvalid;
    case 'TELEGRAM_PHONE_INVALID':
    case 'SESSION_PHONE_INVALID': return t.errors.phoneInvalid;
    case 'ENGINE_DISABLED': return t.errors.engineDisabled;
    default: return null;
  }
}

/**
 * Login do Telegram por telefone + código (e senha de duas etapas quando a conta tem).
 * A fase vem do status da sessão (`AWAITING_CODE` → campo de código; `AWAITING_PASSWORD` →
 * senha): recarregar a página volta ao ponto certo sem guardar nada local. O cooldown de
 * reenvio (60 s) e o `FLOOD_WAIT` do Telegram são contagens locais no relógio do servidor.
 * A senha nunca é guardada: vai direto para a API e some do estado.
 */
export function useTelegramLogin(sessionId: string | null, conn: SessionConnection) {
  const [busy, setBusy] = useState<'send' | 'signIn' | 'password' | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resend, setResend] = useState<Window | null>(null);
  const [flood, setFlood] = useState<Window | null>(null);
  const [sentOnce, setSentOnce] = useState(false);

  const phase: TelegramLoginPhase =
    conn.status === 'AWAITING_PASSWORD' ? 'password'
      : conn.status === 'AWAITING_CODE' ? 'code'
        : 'idle';

  useEffect(() => {
    if (!sessionId) { setResend(null); setFlood(null); setSentOnce(false); setError(null); setCodeError(null); setPasswordError(null); }
  }, [sessionId]);

  const fail = useCallback((err: unknown, fallback: string, field?: 'code' | 'password') => {
    const e = err as ApiError;
    if (e.code === 'TELEGRAM_FLOOD_WAIT') {
      const seconds = Number(e.meta?.seconds ?? 60);
      const now = serverNow();
      setFlood({ startAt: now, endAt: now + Math.max(1, seconds) * 1000 });
      return;
    }
    const known = telegramErrorMessage(e.code);
    const message = known ?? e.message ?? fallback;
    if (field === 'code') setCodeError(message);
    else if (field === 'password') setPasswordError(message);
    else setError(message);
  }, []);

  const sendCode = useCallback(async () => {
    if (!sessionId || busy) return;
    setBusy('send'); setError(null); setCodeError(null);
    try {
      const res = await sessionService.telegramSendCode(sessionId);
      const now = serverNow();
      setResend({ startAt: now, endAt: now + TELEGRAM_CODE_RESEND_MS });
      setSentOnce(true);
      await conn.pushStatus(res.status);
    } catch (err) {
      fail(err, t.errors.sendFailed);
    } finally {
      setBusy(null);
    }
  }, [sessionId, busy, conn, fail]);

  const signIn = useCallback(async (code: string) => {
    if (!sessionId || busy) return;
    setBusy('signIn'); setCodeError(null); setError(null);
    try {
      const res = await sessionService.telegramSignIn(sessionId, code);
      await conn.pushStatus(res.status);
    } catch (err) {
      fail(err, t.errors.generic, 'code');
    } finally {
      setBusy(null);
    }
  }, [sessionId, busy, conn, fail]);

  const submitPassword = useCallback(async (password: string) => {
    if (!sessionId || busy) return;
    setBusy('password'); setPasswordError(null); setError(null);
    try {
      const res = await sessionService.telegramPassword(sessionId, password);
      await conn.pushStatus(res.status);
    } catch (err) {
      fail(err, t.errors.generic, 'password');
    } finally {
      setBusy(null);
    }
  }, [sessionId, busy, conn, fail]);

  return {
    phase,
    busy,
    error,
    codeError,
    passwordError,
    /** Janela de espera para reenviar (`null` = pode reenviar). */
    resend,
    /** Espera pedida pelo Telegram (`FLOOD_WAIT`). */
    flood,
    sentOnce,
    sendCode,
    signIn,
    submitPassword,
    clearResend: () => setResend(null),
    clearFlood: () => setFlood(null),
    clearCodeError: () => setCodeError(null),
    clearPasswordError: () => setPasswordError(null),
  };
}

export type TelegramLogin = ReturnType<typeof useTelegramLogin>;
