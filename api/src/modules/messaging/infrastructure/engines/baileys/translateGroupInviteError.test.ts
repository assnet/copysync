import { describe, it, expect } from 'vitest';
import { translateGroupInviteError } from './BaileysErrorTranslator';

// Boom do IQ: código do WhatsApp em `data`, `statusCode` 500 (default do Boom).
const iqBoom = (text: string, data: number) => Object.assign(new Error(text), { output: { statusCode: 500 }, data });

describe('translateGroupInviteError', () => {
  it('Boom data 401 vira GROUP_INVITE_NOT_ALLOWED', () => {
    expect(translateGroupInviteError(iqBoom('x', 401)).code).toBe('GROUP_INVITE_NOT_ALLOWED');
  });

  it('Boom data 403 vira GROUP_INVITE_NOT_ALLOWED com 403', () => {
    const err = translateGroupInviteError(iqBoom('x', 403));
    expect(err.code).toBe('GROUP_INVITE_NOT_ALLOWED');
    expect(err.statusCode).toBe(403);
  });

  it('mensagem forbidden/not-authorized sem código vira GROUP_INVITE_NOT_ALLOWED', () => {
    expect(translateGroupInviteError(iqBoom('forbidden', 0)).code).toBe('GROUP_INVITE_NOT_ALLOWED');
    expect(translateGroupInviteError(new Error('not-authorized')).code).toBe('GROUP_INVITE_NOT_ALLOWED');
  });

  it('outro erro segue o tradutor padrão', () => {
    expect(translateGroupInviteError(iqBoom('item-not-found', 404)).code).toBe('ENGINE_TEMPORARILY_UNAVAILABLE');
    expect(translateGroupInviteError(new Error('Connection not open')).code).toBe('SESSION_NOT_CONNECTED');
  });
});
