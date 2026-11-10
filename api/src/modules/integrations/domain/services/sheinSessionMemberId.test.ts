import { describe, expect, it } from 'vitest';
import { sheinSessionMemberId } from './sheinSessionMemberId';

const seg = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const token = (payload: unknown) => `${seg({ alg: 'x' })}.${seg(payload)}.sig.extra`;

describe('sheinSessionMemberId', () => {
  it('lê `m` numérico do 2º segmento (token de 4 segmentos)', () => {
    expect(sheinSessionMemberId(token({ b: 7, g: 1, r: 'x', t: 2, m: 4320454940, l: 9 }))).toBe('4320454940');
  });

  it('aceita `m` string de dígitos', () => {
    expect(sheinSessionMemberId(token({ m: '123456789' }))).toBe('123456789');
  });

  it.each([
    ['vazio', ''],
    ['um segmento só', 'abc'],
    ['payload não base64url', 'a.$$$.c.d'],
    ['payload não JSON', `a.${seg('não é json')}.c.d`],
    ['JSON array', token([1, 2])],
    ['sem m', token({ b: 7 })],
    ['m curto demais', token({ m: 12345 })],
    ['m com letras', token({ m: '12a456789' })],
    ['m negativo', token({ m: -4320454940 })],
    ['m fracionário', token({ m: 1234567.5 })],
    ['token gigante', `a.${'A'.repeat(5000)}.c.d`],
  ])('%s → null', (_n, t) => {
    expect(sheinSessionMemberId(t)).toBeNull();
  });
});
