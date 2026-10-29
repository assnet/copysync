import { describe, expect, it } from 'vitest';
import {
  formatRelativeTime, isValidHostname, isValidLandingUrl, mergeReservedNames, normalizeHostname, normalizeReservedName,
  RESERVED_NAMES_MAX,
} from './rules';

describe('isValidLandingUrl', () => {
  it('vazio é válido (sem landing)', () => {
    expect(isValidLandingUrl('')).toBe(true);
    expect(isValidLandingUrl('   ')).toBe(true);
  });

  it('aceita https com host válido', () => {
    expect(isValidLandingUrl('https://www.exemplo.com.br')).toBe(true);
    expect(isValidLandingUrl('https://exemplo.com/pagina?x=1')).toBe(true);
  });

  it.each([
    'http://exemplo.com',
    'exemplo.com',
    'https://user:senha@exemplo.com',
    'https://localhost',
    'https://127.0.0.1',
    'javascript:alert(1)',
    'ftp://exemplo.com',
  ])('recusa %s', (url) => {
    expect(isValidLandingUrl(url)).toBe(false);
  });
});

describe('hostname', () => {
  it('normaliza esquema, caminho, porta e caixa', () => {
    expect(normalizeHostname(' HTTPS://Exemplo.COM.br:443/x ')).toBe('exemplo.com.br');
  });

  it('valida', () => {
    expect(isValidHostname('copysync.com.br')).toBe(true);
    expect(isValidHostname('semponto')).toBe(false);
    expect(isValidHostname('10.0.0.1')).toBe(false);
    expect(isValidHostname('-ruim.com')).toBe(false);
  });
});

describe('nomes reservados', () => {
  it('normaliza e recusa inválidos', () => {
    expect(normalizeReservedName(' Loja ')).toBe('loja');
    expect(normalizeReservedName('com espaço')).toBeNull();
    expect(normalizeReservedName('-x')).toBeNull();
  });

  it('junta sem duplicar e separa por vírgula/espaço', () => {
    expect(mergeReservedNames(['loja'], 'Loja, promo vip')).toEqual({ ok: true, names: ['loja', 'promo', 'vip'] });
  });

  it('aponta o nome inválido', () => {
    expect(mergeReservedNames([], 'ok, ru_im')).toEqual({ ok: false, invalid: 'ru_im' });
  });

  it('limita a RESERVED_NAMES_MAX (1000)', () => {
    expect(RESERVED_NAMES_MAX).toBe(1000);
    const many = Array.from({ length: RESERVED_NAMES_MAX }, (_, i) => `n${i}`);
    expect(mergeReservedNames(many, 'mais')).toEqual({ ok: false, tooMany: true });
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-10-29T12:00:00.000Z');
  it('minutos e horas no passado', () => {
    expect(formatRelativeTime('2026-10-29T11:55:00.000Z', now, 'agora')).toBe('há 5 minutos');
    expect(formatRelativeTime('2026-10-29T10:00:00.000Z', now, 'agora')).toBe('há 2 horas');
  });
  it('menos de um minuto', () => {
    expect(formatRelativeTime('2026-10-29T11:59:40.000Z', now, 'agora')).toBe('agora');
  });
  it('data inválida vira vazio', () => {
    expect(formatRelativeTime('x', now, 'agora')).toBe('');
  });
});
