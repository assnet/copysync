import { describe, expect, it } from 'vitest';
import { PASSWORD_RESET_LIMITS, evaluatePasswordResetRequest, isPasswordResetUsable } from './passwordResetRules';

const now = Date.parse('2026-11-11T12:00:00Z');
const ago = (min: number) => new Date(now - min * 60_000);

describe('evaluatePasswordResetRequest', () => {
  it('abaixo do teto: permitido', () => {
    expect(evaluatePasswordResetRequest({ emailRequests: [ago(5), ago(10)], ipRequests: [], now })).toEqual({ allowed: true });
  });
  it('3 pedidos do e-mail na hora: bloqueia até o mais antigo sair da janela', () => {
    const d = evaluatePasswordResetRequest({ emailRequests: [ago(5), ago(10), ago(50)], ipRequests: [], now });
    expect(d).toEqual({ allowed: false, reason: 'EMAIL', retryAt: new Date(ago(50).getTime() + PASSWORD_RESET_LIMITS.windowMs) });
  });
  it('pedido fora da janela não conta', () => {
    expect(evaluatePasswordResetRequest({ emailRequests: [ago(5), ago(10), ago(61)], ipRequests: [], now }).allowed).toBe(true);
  });
  it('10 pedidos do IP: bloqueia por IP', () => {
    const ipRequests = Array.from({ length: 10 }, (_, i) => ago(i + 1));
    expect(evaluatePasswordResetRequest({ emailRequests: [], ipRequests, now })).toMatchObject({ allowed: false, reason: 'IP' });
  });
});

describe('isPasswordResetUsable', () => {
  const ok = { userId: 'u1', expiresAt: new Date(now + 1000), usedAt: null, invalidatedAt: null };
  it('aberto e no prazo: utilizável', () => expect(isPasswordResetUsable(ok, now)).toBe(true));
  it('inexistente, sem conta, vencido, usado ou invalidado: não', () => {
    expect(isPasswordResetUsable(null, now)).toBe(false);
    expect(isPasswordResetUsable({ ...ok, userId: null }, now)).toBe(false);
    expect(isPasswordResetUsable({ ...ok, expiresAt: new Date(now) }, now)).toBe(false);
    expect(isPasswordResetUsable({ ...ok, usedAt: ago(1) }, now)).toBe(false);
    expect(isPasswordResetUsable({ ...ok, invalidatedAt: ago(1) }, now)).toBe(false);
  });
});
