/** Confirmação de senha em ação sensível: 5 falhas em 15 min bloqueiam o usuário por 15 min. */
export const PASSWORD_CONFIRMATION_MAX_FAILURES = 5;
export const PASSWORD_CONFIRMATION_WINDOW_MS = 15 * 60_000;
export const PASSWORD_CONFIRMATION_LOCK_MS = 15 * 60_000;
/** Quanto histórico a decisão precisa ler: a janela que formou o bloqueio + o bloqueio. */
export const PASSWORD_CONFIRMATION_LOOKBACK_MS = PASSWORD_CONFIRMATION_WINDOW_MS + PASSWORD_CONFIRMATION_LOCK_MS;
/** Linhas mais antigas que isto são podadas na própria tentativa (sem job). */
export const PASSWORD_CONFIRMATION_RETENTION_MS = 24 * 60 * 60_000;

export type PasswordConfirmationLock = { locked: false } | { locked: true; retryAfterSeconds: number };

/**
 * Bloqueado enquanto `agora < f + 15 min`, onde `f` é a falha que completou 5 dentro de 15 min.
 * Tentativa bloqueada não é gravada, então o bloqueio não se estende sozinho; passado o prazo o
 * usuário tem 5 tentativas novas (as antigas não formam grupo com as novas: distam > 15 min).
 */
export function evaluatePasswordConfirmationLock(failures: readonly Date[], now: Date): PasswordConfirmationLock {
  const times = failures.map((d) => d.getTime()).sort((a, b) => a - b);
  const span = PASSWORD_CONFIRMATION_MAX_FAILURES - 1;
  let lockedUntil = 0;
  for (let i = span; i < times.length; i++) {
    if (times[i]! - times[i - span]! <= PASSWORD_CONFIRMATION_WINDOW_MS) {
      lockedUntil = Math.max(lockedUntil, times[i]! + PASSWORD_CONFIRMATION_LOCK_MS);
    }
  }
  const left = lockedUntil - now.getTime();
  return left > 0 ? { locked: true, retryAfterSeconds: Math.max(1, Math.ceil(left / 1000)) } : { locked: false };
}
