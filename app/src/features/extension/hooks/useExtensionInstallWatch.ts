import { useCallback, useEffect, useRef, useState } from 'react';
import { usePersistedState, writePersisted } from '@/hooks/usePersistedState';
import { detectExtension } from '../channel/client';

export const INSTALL_WATCH_KEY = 'extension.installWatch';
export const INSTALL_WATCH_INTERVAL_MS = 3_000;
export const INSTALL_WATCH_TIMEOUT_MS = 3 * 60_000;

export type InstallWatchPhase = 'idle' | 'waiting' | 'timed_out' | 'detected';

export interface InstallWatchOptions {
  onDetected: () => void;
  /** Checagem leve (handshake). Padrão: `detectExtension` do canal. */
  detect?: () => Promise<boolean>;
  intervalMs?: number;
  timeoutMs?: number;
  /** Relógio local (só mede a espera nesta aba; nada vem do servidor). */
  now?: () => number;
}

/**
 * Espera a extensão aparecer depois do clique em "Instalar": checa a cada `intervalMs`, ao
 * voltar para a aba (`visibilitychange`/`focus`) e para em `timeoutMs`. O início da espera fica
 * em `usePersistedState` (aba): recarregar a página retoma a espera; detectar limpa.
 */
export function useExtensionInstallWatch({
  onDetected,
  detect = detectExtension,
  intervalMs = INSTALL_WATCH_INTERVAL_MS,
  timeoutMs = INSTALL_WATCH_TIMEOUT_MS,
  now = Date.now,
}: InstallWatchOptions) {
  const [waitingSince, setWaitingSince, clearWaiting] = usePersistedState<number | null>(INSTALL_WATCH_KEY, null);
  const [timedOut, setTimedOut] = useState(false);
  const [detected, setDetected] = useState(false);

  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const detectRef = useRef(detect);
  detectRef.current = detect;
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => {
    if (waitingSince == null || timedOut || detected) return undefined;
    let cancelled = false;
    let inFlight = false;

    const expired = () => nowRef.current() - waitingSince >= timeoutMs;

    const check = async () => {
      if (cancelled || inFlight) return;
      if (expired()) {
        setTimedOut(true);
        return;
      }
      inFlight = true;
      let ok = false;
      try {
        ok = await detectRef.current();
      } catch {
        ok = false;
      }
      inFlight = false;
      if (cancelled) return;
      if (ok) {
        setDetected(true);
        clearWaiting();
        onDetectedRef.current();
      } else if (expired()) {
        setTimedOut(true);
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };

    void check();
    const timer = window.setInterval(() => void check(), intervalMs);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [waitingSince, timedOut, detected, intervalMs, timeoutMs, clearWaiting]);

  /** Começa (ou recomeça) a espera com um novo teto. */
  const start = useCallback(() => {
    setDetected(false);
    setTimedOut(false);
    setWaitingSince(nowRef.current());
  }, [setWaitingSince]);

  /** Grava a espera já, sem esperar o efeito: para quando a página vai recarregar em seguida. */
  const startBeforeReload = useCallback(() => {
    writePersisted<number | null>(INSTALL_WATCH_KEY, nowRef.current());
  }, []);

  const stop = useCallback(() => {
    setTimedOut(false);
    clearWaiting();
  }, [clearWaiting]);

  let phase: InstallWatchPhase = 'idle';
  if (detected) phase = 'detected';
  else if (timedOut) phase = 'timed_out';
  else if (waitingSince != null) phase = 'waiting';

  return { phase, waitingSince, start, startBeforeReload, stop };
}
