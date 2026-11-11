/**
 * Regras puras da recuperação de senha (docs/recuperacao-de-senha.md). Sem banco nem relógio
 * implícito: quem chama passa `now` e as datas lidas do repositório.
 */
import { slidingWindowRetryAt } from './loginGuardRules';

export const PASSWORD_RESET_LIMITS = {
  /** Janela deslizante dos pedidos. */
  windowMs: 60 * 60 * 1000,
  /** Pedidos por e-mail na janela (exista ou não a conta). */
  maxEmailRequests: 3,
  /** Pedidos por IP na janela. */
  maxIpRequests: 10,
  /** Validade do link. */
  tokenTtlMs: 60 * 60 * 1000,
  /** Linhas mais antigas que isso são podadas. */
  retentionMs: 30 * 24 * 60 * 60 * 1000,
} as const;

export type PasswordResetRequestDecision = { allowed: true } | { allowed: false; retryAt: Date; reason: 'EMAIL' | 'IP' };

/**
 * `emailRequests`/`ipRequests` = pedidos ANTERIORES na janela (sem o que está sendo avaliado).
 * Vale o horário de liberação mais distante.
 */
export function evaluatePasswordResetRequest(input: { emailRequests: Date[]; ipRequests: Date[]; now: number }): PasswordResetRequestDecision {
  const { windowMs, maxEmailRequests, maxIpRequests } = PASSWORD_RESET_LIMITS;
  const byEmail = slidingWindowRetryAt(input.emailRequests, maxEmailRequests, input.now, windowMs);
  const byIp = slidingWindowRetryAt(input.ipRequests, maxIpRequests, input.now, windowMs);
  if (!byEmail && !byIp) return { allowed: true };
  if (byEmail && (!byIp || byEmail >= byIp)) return { allowed: false, retryAt: byEmail, reason: 'EMAIL' };
  return { allowed: false, retryAt: byIp!, reason: 'IP' };
}

export interface PasswordResetTokenState {
  userId: string | null;
  expiresAt: Date | null;
  usedAt: Date | null;
  invalidatedAt: Date | null;
}

/** Link utilizável: tem conta, não foi usado nem invalidado e está no prazo. */
export function isPasswordResetUsable(row: PasswordResetTokenState | null, now: number): boolean {
  if (!row || !row.userId || !row.expiresAt) return false;
  if (row.usedAt || row.invalidatedAt) return false;
  return row.expiresAt.getTime() > now;
}
