import { describe, expect, it } from 'vitest';
import {
  LEGACY_PRODUCTS, PRODUCT_PLANS_PATH, SUBSCRIPTION_PATH, hasProduct, plansPathFor, productsOfTenant, resolveHomePath,
} from './productAccess';

describe('productsOfTenant', () => {
  it('tenant carregado sem o campo (API antiga) = legado', () => {
    expect(productsOfTenant({})).toEqual([...LEGACY_PRODUCTS]);
    expect(productsOfTenant(undefined)).toEqual(['AFFILIATES', 'CHAT']);
  });

  it('usa a lista da API e ignora chave desconhecida', () => {
    expect(productsOfTenant({ products: ['SAVER', 'FUTURO'] })).toEqual(['SAVER']);
    expect(productsOfTenant({ products: [] })).toEqual([]);
  });

  it('super admin passa o gate: todos os produtos, mesmo sem a linha', () => {
    expect(productsOfTenant({ role: 'SUPER_ADMIN', products: ['AFFILIATES', 'CHAT'] })).toEqual(['AFFILIATES', 'CHAT', 'SAVER']);
    expect(productsOfTenant({ role: 'ADMIN', products: ['SAVER'] })).toEqual(['SAVER']);
  });
});

describe('resolveHomePath', () => {
  it('com Afiliados = /dashboard (como hoje)', () => {
    expect(resolveHomePath(['AFFILIATES', 'CHAT'])).toBe('/dashboard');
    expect(resolveHomePath(['SAVER', 'AFFILIATES'])).toBe('/dashboard');
  });

  it('só-Saver: início no Saver; nenhum produto = assinatura', () => {
    expect(resolveHomePath(['SAVER'])).toBe('/saver');
    expect(resolveHomePath([])).toBe(SUBSCRIPTION_PATH);
  });

  it('nenhum produto = assinatura', () => {
    expect(resolveHomePath([])).toBe(SUBSCRIPTION_PATH);
  });
});

describe('hasProduct / plansPathFor', () => {
  it('hasProduct', () => {
    expect(hasProduct(['AFFILIATES'], 'AFFILIATES')).toBe(true);
    expect(hasProduct(['SAVER'], 'AFFILIATES')).toBe(false);
  });

  it('vitrine por produto; Chat acompanha Afiliados; sem vitrine = assinatura', () => {
    expect(plansPathFor('AFFILIATES')).toBe('/affiliates/plans');
    expect(plansPathFor('CHAT')).toBe(PRODUCT_PLANS_PATH.AFFILIATES);
    expect(plansPathFor('SAVER')).toBe('/saver/plans');
  });
});
