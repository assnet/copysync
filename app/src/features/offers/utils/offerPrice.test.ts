import { describe, expect, it } from 'vitest';
import { centsToInput, discountPercent, parseCentsInput } from './offerPrice';
import { toOfferError } from './offerErrors';

describe('offerPrice', () => {
  it('máscara usa os dois últimos dígitos como centavos', () => {
    expect(parseCentsInput('R$ 1.234,56')).toBe(123456);
    expect(parseCentsInput('5')).toBe(5);
    expect(parseCentsInput('')).toBeNull();
    expect(parseCentsInput('R$ ')).toBeNull();
  });

  it('formata e volta ao mesmo valor', () => {
    expect(parseCentsInput(centsToInput(9990))).toBe(9990);
    expect(centsToInput(null)).toBe('');
  });

  it('desconto só quando o original é maior', () => {
    expect(discountPercent(7500, 10000)).toBe(25);
    expect(discountPercent(10000, 10000)).toBeNull();
    expect(discountPercent(null, 10000)).toBeNull();
  });
});

describe('toOfferError', () => {
  it('limite do plano usa meta.limit', () => {
    expect(toOfferError({ code: 'PLAN_LIMIT_REACHED', meta: { limit: 20 } }).message).toContain('20');
  });

  it('credencial ausente aponta para as credenciais', () => {
    expect(toOfferError({ code: 'AFFILIATE_CREDENTIAL_NOT_FOUND' }).action).toBe('credentials');
  });

  it('link não suportado é erro do campo', () => {
    expect(toOfferError({ code: 'OFFER_URL_UNSUPPORTED' }).isLinkField).toBe(true);
  });

  it('código desconhecido cai no genérico', () => {
    expect(toOfferError(new Error('x')).code).toBeNull();
  });
});
