import { useCallback, useEffect, useRef, useState } from 'react';

/** Esperas antes de cada nova tentativa automática; da 4ª em diante, o teto. */
export const AUTO_RETRY_DELAYS_MS = [5_000, 10_000, 20_000] as const;
export const AUTO_RETRY_MAX_DELAY_MS = 30_000;
/** Tentando há mais que isto: a tela avisa que está demorando (sem desistir). */
export const AUTO_RETRY_SLOW_AFTER_MS = 180_000;

/** Espera antes da tentativa `attempt` (0 = primeira): 5 s → 10 s → 20 s → 30 s (teto). */
export function autoRetryDelay(attempt: number): number {
  return Math.min(AUTO_RETRY_DELAYS_MS[attempt] ?? AUTO_RETRY_MAX_DELAY_MS, AUTO_RETRY_MAX_DELAY_MS);
}

function isTabHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export interface AutoRetryState {
  /** Segundos até a próxima tentativa; `null` enquanto tenta. */
  secondsLeft: number | null;
  /** Tentativa em andamento (automática ou "Tentar agora"). */
  retrying: boolean;
  /** Aba oculta: a contagem para e retoma do mesmo ponto ao voltar. */
  paused: boolean;
  /** Tentativas já feitas (automáticas e "Tentar agora"), todas sem sucesso até aqui. */
  attempts: number;
  /** Tentando há mais de `AUTO_RETRY_SLOW_AFTER_MS` (3 min). */
  slow: boolean;
  /** Tenta já, sem esperar a contagem (ignorado se já estiver tentando). */
  retryNow: () => void;
}

/**
 * Nova tentativa automática com backoff (5 s → 10 s → 20 s, teto 30 s) e contagem visível.
 *
 * - Um único `setTimeout` por vez, re-armado a cada segundo até o prazo: nunca `setInterval`
 *   (sem ticks acumulando nem deriva quando o navegador atrasa o timer).
 * - Aba oculta: cancela o timer e guarda o que faltava; ao voltar, retoma dali.
 * - Relógio local (`Date.now()`), não `serverNow()`: quem usa isto é a tela com a API fora do
 *   ar, então não há `X-Server-Time` novo, e a contagem é só uma espera do próprio navegador
 *   (não compara com horário vindo do servidor).
 * - Quem chama desmonta o componente quando a tentativa dá certo; se a automática falhar, a
 *   próxima espera é a seguinte da escada. "Tentar agora" não avança a escada: reinicia a espera
 *   do degrau atual.
 * - Não desiste; depois de 3 min marca `slow` para a tela sugerir avisar o suporte.
 */
export function useAutoRetry(onRetry: () => unknown): AutoRetryState {
  const [attempts, setAttempts] = useState(0);
  /** Tentativa em voo e quem a disparou ('auto' avança a escada; 'manual' não). */
  const [running, setRunning] = useState<null | 'auto' | 'manual'>(null);
  const retrying = running !== null;
  const [paused, setPaused] = useState(isTabHidden);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(() => Math.ceil(autoRetryDelay(0) / 1000));
  /** Quanto falta da espera atual (ms), preservado entre pausas. */
  const remainingRef = useRef(autoRetryDelay(0));
  const attemptsRef = useRef(0);
  /** Degrau da escada de esperas (só tentativas automáticas avançam). */
  const stepRef = useRef(0);
  const startedAt = useRef(Date.now());
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;
  const mounted = useRef(true);
  const inFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const onVisibility = () => setPaused(isTabHidden());
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Contagem: ativa só esperando e com a aba visível.
  useEffect(() => {
    if (retrying || paused) return undefined;
    const deadline = Date.now() + remainingRef.current;
    let timer: number | undefined;
    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      remainingRef.current = left;
      if (left <= 0) {
        setRunning('auto');
        return;
      }
      setSecondsLeft(Math.ceil(left / 1000));
      // Próximo tick na virada do segundo exibido.
      timer = window.setTimeout(tick, left % 1000 || 1000);
    };
    tick();
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(0, deadline - Date.now());
    };
  }, [retrying, paused, attempts]);

  // Tentativa: roda uma vez por entrada em `retrying`; ao terminar arma a próxima espera.
  useEffect(() => {
    if (!running || inFlight.current) return; // StrictMode roda o efeito 2×: uma tentativa só
    inFlight.current = true;
    const source = running;
    setSecondsLeft(null);
    void Promise.resolve()
      .then(() => onRetryRef.current())
      .catch(() => undefined)
      .then(() => {
        inFlight.current = false;
        if (!mounted.current) return;
        attemptsRef.current += 1;
        if (source === 'auto') stepRef.current += 1;
        remainingRef.current = autoRetryDelay(stepRef.current);
        setSecondsLeft(Math.ceil(remainingRef.current / 1000));
        setAttempts(attemptsRef.current);
        setRunning(null);
      });
  }, [running]);

  const retryNow = useCallback(() => setRunning((r) => r ?? 'manual'), []);
  // Recalculado a cada render (a contagem re-renderiza por segundo).
  const slow = Date.now() - startedAt.current >= AUTO_RETRY_SLOW_AFTER_MS;

  return { secondsLeft, retrying, paused, attempts, slow, retryNow };
}
