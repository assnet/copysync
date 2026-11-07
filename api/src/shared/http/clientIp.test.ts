import { describe, expect, it } from 'vitest';
import { resolveClientIp } from './clientIp';

describe('resolveClientIp', () => {
  it('cf-connecting-ip válido vence; X-Forwarded-For nunca é lido', () => {
    expect(resolveClientIp({ headers: { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' }, ip: '10.0.0.1' })).toBe('203.0.113.7');
    expect(resolveClientIp({ headers: { 'cf-connecting-ip': '2001:db8::1' }, ip: '10.0.0.1' })).toBe('2001:db8::1');
  });
  it('cf-connecting-ip ausente ou inválido: request.ip (salto do proxy confiável)', () => {
    expect(resolveClientIp({ headers: { 'x-forwarded-for': '1.1.1.1' }, ip: '10.0.0.1' })).toBe('10.0.0.1');
    expect(resolveClientIp({ headers: { 'cf-connecting-ip': 'evil, 1.1.1.1' }, ip: '10.0.0.1' })).toBe('10.0.0.1');
  });
});
