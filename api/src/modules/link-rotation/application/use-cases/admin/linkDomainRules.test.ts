import { describe, expect, it } from 'vitest';
import { isPlatformHostname, parseHostname, parseLandingUrl, parseReservedNames, platformHostnames } from './linkDomainRules';

describe('linkDomainRules', () => {
  it('normaliza hostname', () => {
    expect(parseHostname(' HTTPS://Copysync.COM.br.:443/x?y ')).toBe('copysync.com.br');
    expect(parseHostname('copysync.com.br')).toBe('copysync.com.br');
  });

  it.each(['localhost', 'copysync', '-a.com', 'a-.com', 'a_b.com', '1.2.3.4', 'a..com', '[::1]', 'çopy.com', ''])(
    'recusa %s',
    (h) => expect(parseHostname(h)).toBeNull(),
  );

  it('hosts da plataforma e subdomínios deles', () => {
    const p = platformHostnames('https://painel.exemplo.com/app');
    expect(p).toContain('painel.exemplo.com');
    expect(isPlatformHostname('api.copysync.app', p)).toBe(true);
    expect(isPlatformHostname('x.app.copysync.app', p)).toBe(true);
    expect(isPlatformHostname('copysync.com.br', p)).toBe(false);
  });

  it('landingUrl: null/vazio, https ok, resto inválido', () => {
    expect(parseLandingUrl(null)).toBeNull();
    expect(parseLandingUrl('  ')).toBeNull();
    expect(parseLandingUrl('https://copysync.app/promo')).toBe('https://copysync.app/promo');
    for (const bad of ['http://copysync.app', 'javascript:alert(1)', 'https://localhost', 'https://u:p@a.com', 'nada'])
      expect(parseLandingUrl(bad)).toBeUndefined();
  });

  it('reservedNames normaliza e deduplica', () => {
    expect(parseReservedNames([' Promo VIP ', 'promo-vip', '', 'Ação'])).toEqual(['promo-vip', 'acao']);
    expect(parseReservedNames(['a'.repeat(51)])).toBeNull();
    expect(parseReservedNames(['a!b'])).toBeNull();
  });
});
