import { describe, expect, it } from 'vitest';
import { appendCheckoutPrefill, isCheckoutPrefillTarget } from './checkoutPrefill';

const BASE = 'https://pay.cakto.com.br/abc_1';
const P = { email: 'ana@x.com', confirmEmail: 'ana@x.com', name: 'Ana Souza' };

describe('isCheckoutPrefillTarget', () => {
  it('só https em pay.cakto.com.br', () => {
    expect(isCheckoutPrefillTarget(BASE)).toBe(true);
    expect(isCheckoutPrefillTarget('http://pay.cakto.com.br/abc')).toBe(false);
    expect(isCheckoutPrefillTarget('https://pay.cakto.com.br.evil.com/abc')).toBe(false);
    expect(isCheckoutPrefillTarget('https://outro.com/abc')).toBe(false);
    expect(isCheckoutPrefillTarget('nao-e-url')).toBe(false);
    expect(isCheckoutPrefillTarget(null)).toBe(false);
  });
});

describe('appendCheckoutPrefill', () => {
  it('anexa name, email e confirmEmail sem re-serializar a query existente', () => {
    const url = `${BASE}?utm_source=app&sck=a%20b`;
    expect(appendCheckoutPrefill(url, P)).toBe(`${url}&name=Ana+Souza&email=ana%40x.com&confirmEmail=ana%40x.com`);
  });

  it('link que já traz e-mail (qualquer caixa) não recebe nada', () => {
    expect(appendCheckoutPrefill(`${BASE}?EMAIL=b%40y.com`, P)).toBe(`${BASE}?EMAIL=b%40y.com`);
  });

  it('chave já preenchida não é sobrescrita; segmento vazio da chave preenchida sai', () => {
    expect(appendCheckoutPrefill(`${BASE}?name=Bia&email=&x=1`, P)).toBe(`${BASE}?name=Bia&x=1&email=ana%40x.com&confirmEmail=ana%40x.com`);
  });

  it('host diferente, prefill vazio ou inválido → URL intacta', () => {
    expect(appendCheckoutPrefill('https://outro.com/x', P)).toBe('https://outro.com/x');
    expect(appendCheckoutPrefill(BASE, {})).toBe(BASE);
    expect(appendCheckoutPrefill(BASE, null)).toBe(BASE);
    expect(appendCheckoutPrefill(BASE, { email: '  ' })).toBe(BASE);
  });

  it('ignora chave fora da lista (ex.: telefone)', () => {
    expect(appendCheckoutPrefill(BASE, { phone: '11999999999', name: 'Ana' } as never)).toBe(`${BASE}?name=Ana`);
  });
});
