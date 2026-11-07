import { describe, expect, it } from 'vitest';
import { isHttpsUrl, isValidSlug, publicRedirectUrl } from './rules';
import { redirectLinkErrorMessage } from './errors';
import { redirectLinksStrings as s } from './strings';

describe('regras do link de redirecionamento', () => {
  it('slug: mesma regra da API', () => {
    expect(isValidSlug('chrome-web-store-v5.235.2')).toBe(true);
    expect(isValidSlug(' Suporte ')).toBe(true);
    for (const bad of ['', '-a', 'a-', 'a..b', 'a_b', 'x'.repeat(101)]) expect(isValidSlug(bad)).toBe(false);
  });

  it('destino só https sem credencial', () => {
    expect(isHttpsUrl('https://a.com/x')).toBe(true);
    for (const bad of ['http://a.com', 'javascript:alert(1)', 'https://u:p@a.com', 'lixo', '']) expect(isHttpsUrl(bad)).toBe(false);
  });

  it('endereço público na origem do painel', () => {
    expect(publicRedirectUrl('loja.v2', 'https://app.copysync.app')).toBe('https://app.copysync.app/redirect/loja.v2');
  });

  it('erro: motivo da API tem prioridade; código desconhecido = genérico', () => {
    expect(redirectLinkErrorMessage({ code: 'REDIRECT_LINK_INVALID', meta: { reason: 'LOOP' } })).toBe(s.reasons.LOOP);
    expect(redirectLinkErrorMessage({ code: 'REDIRECT_LINK_SLUG_TAKEN' })).toBe(s.errors.REDIRECT_LINK_SLUG_TAKEN);
    expect(redirectLinkErrorMessage(new Error('x'))).toBe(s.errors.generic);
  });
});
