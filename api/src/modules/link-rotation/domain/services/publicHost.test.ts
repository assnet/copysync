import { describe, expect, it } from 'vitest';
import { matchPublicHost, normalizeHost } from './publicHost';

const DOMAINS = [{ hostname: 'copysync.app' }, { hostname: 'go.copysync.app' }];

describe('publicHost', () => {
  it('normaliza porta, caixa e ponto final', () => {
    expect(normalizeHost(' Promo.CopySync.app.:443 ')).toBe('promo.copysync.app');
    expect(normalizeHost('[::1]:80')).toBe('');
  });

  it('apex, slug e mais de um rótulo', () => {
    expect(matchPublicHost('copysync.app', DOMAINS)).toEqual({ kind: 'apex', domain: DOMAINS[0] });
    expect(matchPublicHost('PROMO.copysync.app:8080', DOMAINS)).toEqual({ kind: 'slug', domain: DOMAINS[0], slug: 'promo' });
    expect(matchPublicHost('www.promo.copysync.app', DOMAINS)).toBeNull();
    expect(matchPublicHost('www.copysync.app', DOMAINS)).toEqual({ kind: 'apex', domain: DOMAINS[0] });
    expect(matchPublicHost('outro.com', DOMAINS)).toBeNull();
    expect(matchPublicHost('xcopysync.app', DOMAINS)).toBeNull();
  });

  it('domínio mais longo vence', () => {
    expect(matchPublicHost('go.copysync.app', DOMAINS)).toEqual({ kind: 'apex', domain: DOMAINS[1] });
    expect(matchPublicHost('vip.go.copysync.app', DOMAINS)).toEqual({ kind: 'slug', domain: DOMAINS[1], slug: 'vip' });
  });
});
