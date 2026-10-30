import { describe, expect, it } from 'vitest';
import { isPlanFeatureUnavailable } from './planGate';

describe('isPlanFeatureUnavailable', () => {
  it('reconhece só PLAN_FEATURE_UNAVAILABLE', () => {
    expect(isPlanFeatureUnavailable(Object.assign(new Error('x'), { status: 403, code: 'PLAN_FEATURE_UNAVAILABLE' }))).toBe(true);
    // PLAN_LIMIT_REACHED também é 403, mas não redireciona
    expect(isPlanFeatureUnavailable(Object.assign(new Error('x'), { status: 403, code: 'PLAN_LIMIT_REACHED' }))).toBe(false);
    expect(isPlanFeatureUnavailable(new Error('x'))).toBe(false);
    expect(isPlanFeatureUnavailable(null)).toBe(false);
    expect(isPlanFeatureUnavailable('PLAN_FEATURE_UNAVAILABLE')).toBe(false);
  });
});
