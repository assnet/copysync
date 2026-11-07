import { describe, expect, it } from 'vitest';
import {
  isSafeRedirectTarget,
  parsePercentA,
  parseRedirectNote,
  parseRedirectSlug,
  validateRedirectDestination,
} from './redirectLinkRules';

const PLATFORM = ['app.copysync.app', 'api.copysync.app'];
const dest = (raw: unknown) => validateRedirectDestination(raw, PLATFORM);

describe('parseRedirectSlug', () => {
  it.each([
    ['chrome-web-store-v5.235.2', 'chrome-web-store-v5.235.2'],
    ['  Suporte ', 'suporte'],
    ['a', 'a'],
    ['x'.repeat(100), 'x'.repeat(100)],
  ])('aceita %s', (raw, expected) => expect(parseRedirectSlug(raw)).toBe(expected));

  it.each(['', '   ', 'x'.repeat(101), '-abc', 'abc-', '.abc', 'abc.', 'a..b', 'a_b', 'a/b', 'ação', 'a b', 42, null])(
    'recusa %s',
    (raw) => expect(parseRedirectSlug(raw)).toBeNull(),
  );
});

describe('validateRedirectDestination', () => {
  it('aceita https e devolve href normalizado', () => {
    expect(dest(' https://Chromewebstore.google.com/detail/x ')).toEqual({
      ok: true, url: 'https://chromewebstore.google.com/detail/x',
    });
  });

  it.each([
    ['', 'EMPTY'],
    [undefined, 'EMPTY'],
    ['nao é url', 'MALFORMED'],
    ['http://site.com', 'NOT_HTTPS'],
    ['javascript:alert(1)', 'NOT_HTTPS'],
    ['data:text/html,x', 'NOT_HTTPS'],
    ['ftp://site.com', 'NOT_HTTPS'],
    ['https://user:pass@site.com', 'CREDENTIALS'],
    ['https://user@site.com', 'CREDENTIALS'],
    [`https://site.com/${'a'.repeat(2048)}`, 'TOO_LONG'],
  ])('recusa %s (%s)', (raw, reason) => expect(dest(raw)).toEqual({ ok: false, reason }));

  it.each([
    'https://app.copysync.app/redirect/outro',
    'https://APP.copysync.app/redirect',
    'https://app.copysync.app/%72edirect/x',
    'https://api.copysync.app/api/public/redirects/x/go',
    'https://www.app.copysync.app/redirect/x',
  ])('recusa loop para a plataforma: %s', (raw) => expect(dest(raw)).toEqual({ ok: false, reason: 'LOOP' }));

  it('host da plataforma fora do redirecionamento é aceito', () => {
    expect(dest('https://app.copysync.app/plans')).toMatchObject({ ok: true });
    expect(dest('https://app.copysync.app/redirection-guide')).toMatchObject({ ok: true });
  });

  it('outro domínio com /redirect é aceito', () => {
    expect(dest('https://loja.exemplo.com/redirect/x')).toMatchObject({ ok: true });
  });
});

describe('isSafeRedirectTarget', () => {
  it('só https sem credencial', () => {
    expect(isSafeRedirectTarget('https://a.com')).toBe(true);
    expect(isSafeRedirectTarget('http://a.com')).toBe(false);
    expect(isSafeRedirectTarget('javascript:alert(1)')).toBe(false);
    expect(isSafeRedirectTarget('https://u:p@a.com')).toBe(false);
    expect(isSafeRedirectTarget('lixo')).toBe(false);
  });
});

describe('parsePercentA / parseRedirectNote', () => {
  it('percentual inteiro 0–100', () => {
    expect(parsePercentA(0)).toBe(0);
    expect(parsePercentA(100)).toBe(100);
    for (const bad of [-1, 101, 50.5, '50', null]) expect(parsePercentA(bad)).toBeNull();
  });

  it('nota vazia vira null; acima de 500 é inválida', () => {
    expect(parseRedirectNote('  ')).toBeNull();
    expect(parseRedirectNote(undefined)).toBeNull();
    expect(parseRedirectNote(' oi ')).toBe('oi');
    expect(parseRedirectNote('x'.repeat(501))).toBeUndefined();
  });
});
