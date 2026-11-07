import { describe, expect, it } from 'vitest';
import { buildCheckoutPrefill } from './checkoutPrefill';

describe('buildCheckoutPrefill', () => {
  it('e-mail em minúsculas vai em email e confirmEmail; nome com espaços colapsados', () => {
    expect(buildCheckoutPrefill({ email: '  Ana.Souza@Exemplo.COM.br ', name: ' Ana   Souza ' })).toEqual({
      email: 'ana.souza@exemplo.com.br',
      confirmEmail: 'ana.souza@exemplo.com.br',
      name: 'Ana Souza',
    });
  });

  it('aceita acentos latinos no nome', () => {
    expect(buildCheckoutPrefill({ email: null, name: 'João Ávila Conceição' })).toEqual({ name: 'João Ávila Conceição' });
  });

  it.each(['ana', 'ana@', 'ana@x', 'a b@x.com', 'ana@x.c', '@x.com'])('e-mail inválido %s é omitido', (email) => {
    expect(buildCheckoutPrefill({ email, name: null })).toEqual({});
  });

  it.each(['Ana 2', 'Ana_Souza', 'Ana.', 'Анна', '李', 'Ana 🙂', 'a'.repeat(101)])('nome fora do padrão %s é omitido', (name) => {
    expect(buildCheckoutPrefill({ email: 'ana@x.com', name })).toEqual({ email: 'ana@x.com', confirmEmail: 'ana@x.com' });
  });

  it('nome com 100 caracteres passa', () => {
    expect(buildCheckoutPrefill({ email: null, name: 'a'.repeat(100) }).name).toHaveLength(100);
  });

  it('entrada vazia/nula não lança e não devolve chave extra', () => {
    expect(buildCheckoutPrefill(null)).toEqual({});
    expect(buildCheckoutPrefill(undefined)).toEqual({});
    expect(buildCheckoutPrefill({ email: '', name: '   ' })).toEqual({});
    const out = buildCheckoutPrefill({ email: 'a@b.co', name: 'Ana', phone: '11999999999' } as never);
    expect(Object.keys(out).sort()).toEqual(['confirmEmail', 'email', 'name']);
  });
});
