import { afterEach, describe, expect, it } from 'vitest';
import { recordServerTime, resetServerClock } from '@/services/serverClock';
import { formatServerClock, loginErrorMessage, retryAtOf, sanitizeCode } from './loginProtection';

afterEach(() => resetServerClock());

describe('loginErrorMessage', () => {
  it('credencial errada: genérica (não diz se o e-mail existe)', () => {
    expect(loginErrorMessage({ code: 'INVALID_CREDENTIALS' })).toBe('E-mail ou senha incorretos.');
  });
  it('bloqueio: "Tente novamente às HH:MM" pelo relógio do servidor', () => {
    const now = Date.now();
    recordServerTime(now + 10 * 60_000, now, now); // servidor 10 min adiantado
    const retryAt = new Date(now + 30 * 60_000).toISOString();
    const expected = new Date(now + 20 * 60_000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    expect(loginErrorMessage({ code: 'LOGIN_TOO_MANY_ATTEMPTS', meta: { retryAt } })).toBe(`Muitas tentativas. Tente novamente às ${expected}.`);
    expect(formatServerClock('lixo')).toBe('');
  });
  it('código: tentativas restantes, expirado, esgotado, envio e erro desconhecido', () => {
    expect(loginErrorMessage({ code: 'LOGIN_CODE_INVALID', meta: { attemptsLeft: 3 } })).toBe('Código incorreto. Restam 3 tentativas.');
    expect(loginErrorMessage({ code: 'LOGIN_CODE_INVALID', meta: { attemptsLeft: 1 } })).toBe('Código incorreto. Resta 1 tentativa.');
    expect(loginErrorMessage({ code: 'LOGIN_CODE_DELIVERY_FAILED' })).toMatch(/Não foi possível enviar o código/);
    expect(loginErrorMessage({ code: 'LOGIN_CODE_EXHAUSTED' })).toMatch(/novo código/);
    expect(loginErrorMessage(new Error('x'))).toMatch(/Não foi possível entrar/);
  });
  it('retryAtOf só aceita ISO válido', () => {
    expect(retryAtOf({ meta: { retryAt: '2026-11-07T12:00:00.000Z' } })).toBe('2026-11-07T12:00:00.000Z');
    expect(retryAtOf({ meta: { retryAt: 'x' } })).toBeNull();
    expect(retryAtOf(null)).toBeNull();
  });
});

describe('sanitizeCode', () => {
  it('só dígitos, até 6 (colar "123 456")', () => {
    expect(sanitizeCode('123 456')).toBe('123456');
    expect(sanitizeCode('12a-34567')).toBe('123456');
  });
});
