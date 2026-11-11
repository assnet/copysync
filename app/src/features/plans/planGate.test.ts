import { describe, expect, it } from 'vitest';
import { PLAN_FEATURE_KEYS, isMercadoLivreTagLimit, isPlanFeatureUnavailable, isSheinUnavailable, planLimitOf } from './planGate';

const err = (key?: string) => ({ status: 403, code: 'PLAN_FEATURE_UNAVAILABLE', ...(key ? { meta: { key } } : {}) });

describe('planGate', () => {
  it('reconhece só PLAN_FEATURE_UNAVAILABLE', () => {
    expect(isPlanFeatureUnavailable(Object.assign(new Error('x'), { status: 403, code: 'PLAN_FEATURE_UNAVAILABLE' }))).toBe(true);
    // PLAN_LIMIT_REACHED também é 403, mas não redireciona
    expect(isPlanFeatureUnavailable(Object.assign(new Error('x'), { status: 403, code: 'PLAN_LIMIT_REACHED' }))).toBe(false);
    expect(isPlanFeatureUnavailable(new Error('x'))).toBe(false);
    expect(isPlanFeatureUnavailable('PLAN_FEATURE_UNAVAILABLE')).toBe(false);
  });

  it('sem featureKey: qualquer PLAN_FEATURE_UNAVAILABLE', () => {
    expect(isPlanFeatureUnavailable(err())).toBe(true);
    expect(isPlanFeatureUnavailable(err('marketplace_shein_enabled'))).toBe(true);
    expect(isPlanFeatureUnavailable({ code: 'PLAN_LIMIT_REACHED' })).toBe(false);
    expect(isPlanFeatureUnavailable(null)).toBe(false);
  });

  it('com featureKey: só a chave do recurso ou chave ausente', () => {
    expect(isPlanFeatureUnavailable(err('storefront_enabled'), PLAN_FEATURE_KEYS.storefront)).toBe(true);
    expect(isPlanFeatureUnavailable(err(), PLAN_FEATURE_KEYS.storefront)).toBe(true);
    expect(isPlanFeatureUnavailable(err('marketplace_shein_enabled'), PLAN_FEATURE_KEYS.storefront)).toBe(false);
    expect(isPlanFeatureUnavailable(err('marketplace_shein_enabled'), PLAN_FEATURE_KEYS.offerStory)).toBe(false);
  });

  it('isSheinUnavailable só com a chave da Shein', () => {
    expect(isSheinUnavailable(err('marketplace_shein_enabled'))).toBe(true);
    expect(isSheinUnavailable(err('storefront_enabled'))).toBe(false);
    expect(isSheinUnavailable(err())).toBe(false);
  });
});

describe('limite de etiquetas do Mercado Livre', () => {
  it('só o PLAN_LIMIT_REACHED da chave de etiquetas', () => {
    expect(isMercadoLivreTagLimit({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'mercado_livre_affiliate_tags', limit: 1 } })).toBe(true);
    expect(isMercadoLivreTagLimit({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'offers_per_day', limit: 10 } })).toBe(false);
    expect(isMercadoLivreTagLimit({ code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: 'mercado_livre_affiliate_tags' } })).toBe(false);
    expect(isMercadoLivreTagLimit(null)).toBe(false);
  });

  it('planLimitOf lê o limite numérico', () => {
    expect(planLimitOf({ meta: { limit: 2 } })).toBe(2);
    expect(planLimitOf({ meta: { limit: '2' } })).toBeNull();
    expect(planLimitOf(undefined)).toBeNull();
  });
});
