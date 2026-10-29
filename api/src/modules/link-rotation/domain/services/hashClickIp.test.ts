import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashClickIp, utcDay } from './hashClickIp';

const AT = new Date('2026-10-29T23:59:59.000Z');

describe('hashClickIp', () => {
  it('sha256(ip + dia UTC + salt) em hex', () => {
    const expected = createHash('sha256').update('1.2.3.42026-10-29salt').digest('hex');
    expect(hashClickIp('1.2.3.4', AT, 'salt')).toBe(expected);
    expect(hashClickIp('1.2.3.4', AT, 'salt')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('muda com o dia UTC, o salt e o IP; normaliza espaço e caixa', () => {
    const base = hashClickIp('1.2.3.4', AT, 'salt');
    expect(hashClickIp('1.2.3.4', new Date('2026-10-30T00:00:00.000Z'), 'salt')).not.toBe(base);
    expect(hashClickIp('1.2.3.4', AT, 'outro')).not.toBe(base);
    expect(hashClickIp('1.2.3.5', AT, 'salt')).not.toBe(base);
    expect(hashClickIp(' FE80::1 ', AT, 's')).toBe(hashClickIp('fe80::1', AT, 's'));
  });

  it('utcDay usa UTC, não o fuso local', () => {
    expect(utcDay(new Date('2026-10-29T02:00:00-03:00'))).toBe('2026-10-29');
    expect(utcDay(new Date('2026-10-29T22:00:00-03:00'))).toBe('2026-10-30');
  });
});
