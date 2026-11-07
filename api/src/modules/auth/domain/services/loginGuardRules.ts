/**
 * Regras puras da proteção do login (docs/seguranca-login.md). Sem banco, sem relógio implícito:
 * quem chama passa `now` e as datas lidas do repositório.
 */

export const LOGIN_GUARD_LIMITS = {
  /** Janela deslizante das falhas e do teto de códigos. */
  windowMs: 60 * 60 * 1000,
  /** Falhas de e-mail/senha por e-mail na janela que bloqueiam (e marcam o e-mail como suspeito). */
  maxEmailFailures: 3,
  /** Falhas por IP na janela que bloqueiam. */
  maxIpFailures: 10,
  /** Quanto tempo a suspeita do e-mail sobrevive sem um código verificado / login limpo. */
  suspicionLookbackMs: 7 * 24 * 60 * 60 * 1000,
  /** Validade do código e do ticket. */
  codeTtlMs: 10 * 60 * 1000,
  /** Códigos enviados por usuário na janela. */
  maxCodesPerWindow: 3,
  /** Tentativas erradas que invalidam o código. */
  maxCodeAttempts: 5,
  /** Intervalo mínimo entre dois envios (botão "reenviar"). */
  resendCooldownMs: 60 * 1000,
  /** Códigos esgotados (5 erros) que travam novos envios na janela diária. */
  maxExhaustedCodesPerDay: 2,
  dayMs: 24 * 60 * 60 * 1000,
} as const;

export type LoginGuardMode = 'off' | 'monitor' | 'enforce';

export interface LoginGuardPolicy {
  mode: LoginGuardMode;
  /** Grava eventos e aplica o bloqueio 429. */
  enforceBlock: boolean;
  /** Exige token Turnstile no login (enforce + site key + secret na API). */
  requireTurnstile: boolean;
  /** Pede código por e-mail no login suspeito. */
  requireEmailCode: boolean;
  /** Avisos de configuração para o log do boot. */
  warnings: string[];
}

/** Modo efetivo a partir do env. Enforce sem secret pula o Turnstile (com aviso). */
export function resolveLoginGuardPolicy(e: {
  LOGIN_GUARD_MODE: LoginGuardMode;
  LOGIN_EMAIL_OTP: boolean;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
}): LoginGuardPolicy {
  const mode = e.LOGIN_GUARD_MODE;
  const warnings: string[] = [];
  const enforce = mode === 'enforce';
  const turnstileReady = !!e.TURNSTILE_SECRET_KEY && !!e.TURNSTILE_SITE_KEY;
  // Sem o par completo o painel não teria como mostrar o widget: exigir o token trancaria todo mundo
  if (enforce && !turnstileReady) warnings.push('LOGIN_GUARD_MODE=enforce without TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY: Turnstile skipped');
  if (!enforce && e.LOGIN_EMAIL_OTP) warnings.push(`LOGIN_EMAIL_OTP=on ignored in LOGIN_GUARD_MODE=${mode}`);
  return {
    mode,
    enforceBlock: mode !== 'off',
    requireTurnstile: enforce && turnstileReady,
    requireEmailCode: enforce && e.LOGIN_EMAIL_OTP,
    warnings,
  };
}

export const normalizeLoginEmail = (email: string | null | undefined): string => (email ?? '').trim().toLowerCase();

/** Datas "no futuro" também contam: o relógio do banco (createdAt) pode estar à frente do `now` da aplicação. */
const sortedInWindow = (dates: Date[], now: number, windowMs: number): number[] =>
  dates.map((d) => d.getTime()).filter((t) => t > now - windowMs).sort((a, b) => a - b);

/**
 * Janela deslizante com teto: bloqueado enquanto houver `max` eventos na última janela.
 * Libera quando o evento que completa o teto sai da janela: `ts[n - max] + janela`
 * (com exatamente `max` falhas, é a mais antiga + 1 h).
 */
export function slidingWindowRetryAt(dates: Date[], max: number, now: number, windowMs: number): Date | null {
  const ts = sortedInWindow(dates, now, windowMs);
  if (ts.length < max) return null;
  return new Date(ts[ts.length - max] + windowMs);
}

export type LoginBlockDecision = { blocked: false } | { blocked: true; retryAt: Date; reason: 'EMAIL' | 'IP' };

/** Bloqueio por e-mail (3/h) ou IP (10/h); vale o horário de liberação mais distante. */
export function evaluateLoginBlock(input: { emailFailures: Date[]; ipFailures: Date[]; now: number }): LoginBlockDecision {
  const { windowMs, maxEmailFailures, maxIpFailures } = LOGIN_GUARD_LIMITS;
  const byEmail = slidingWindowRetryAt(input.emailFailures, maxEmailFailures, input.now, windowMs);
  const byIp = slidingWindowRetryAt(input.ipFailures, maxIpFailures, input.now, windowMs);
  if (!byEmail && !byIp) return { blocked: false };
  if (byEmail && (!byIp || byEmail >= byIp)) return { blocked: true, retryAt: byEmail, reason: 'EMAIL' };
  return { blocked: true, retryAt: byIp!, reason: 'IP' };
}

/**
 * E-mail suspeito: em algum momento (desde o último login limpo/código verificado, dentro do
 * lookback) acumulou o teto de falhas numa mesma janela. Continua suspeito depois que o bloqueio vence.
 */
export function isEmailSuspicious(failuresSinceReset: Date[], now: number): boolean {
  const { maxEmailFailures, windowMs, suspicionLookbackMs } = LOGIN_GUARD_LIMITS;
  const ts = failuresSinceReset
    .map((d) => d.getTime())
    .filter((t) => t > now - suspicionLookbackMs)
    .sort((a, b) => a - b);
  for (let i = 0; i + maxEmailFailures - 1 < ts.length; i++) {
    if (ts[i + maxEmailFailures - 1] - ts[i] < windowMs) return true;
  }
  return false;
}

export type CodeSendDecision = { allowed: true } | { allowed: false; retryAt: Date };

/**
 * Teto de envios (3/h por usuário), intervalo mínimo entre envios e teto diário de códigos
 * esgotados (2 em 24 h: só volta a enviar quando o que completou o teto sai da janela).
 */
export function evaluateCodeSend(sentAt: Date[], now: number, exhaustedAt: Date[] = []): CodeSendDecision {
  const { maxCodesPerWindow, windowMs, resendCooldownMs, maxExhaustedCodesPerDay, dayMs } = LOGIN_GUARD_LIMITS;
  const daily = slidingWindowRetryAt(exhaustedAt, maxExhaustedCodesPerDay, now, dayMs);
  const capped = slidingWindowRetryAt(sentAt, maxCodesPerWindow, now, windowMs);
  const latest = [daily, capped].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
  if (latest) return { allowed: false, retryAt: latest };
  const last = Math.max(0, ...sentAt.map((d) => d.getTime()));
  if (last && last + resendCooldownMs > now) return { allowed: false, retryAt: new Date(last + resendCooldownMs) };
  return { allowed: true };
}

/** Quando o próximo envio fica liberado, contando o envio que acabou de acontecer. */
export function nextCodeSendAt(sentAt: Date[], now: number, exhaustedAt: Date[] = []): Date {
  const d = evaluateCodeSend(sentAt, now, exhaustedAt);
  return d.allowed ? new Date(now) : d.retryAt;
}

export interface LoginCodeState {
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
}

export type LoginCodeUsability = 'USABLE' | 'EXPIRED' | 'EXHAUSTED';

export function loginCodeUsability(code: LoginCodeState, now: number): LoginCodeUsability {
  if (code.consumedAt || code.invalidatedAt || code.expiresAt.getTime() <= now) return 'EXPIRED';
  if (code.attempts >= LOGIN_GUARD_LIMITS.maxCodeAttempts) return 'EXHAUSTED';
  return 'USABLE';
}
