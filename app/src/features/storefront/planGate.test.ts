import { describe, expect, it } from 'vitest';
import { storefrontUpgradePath } from './planGate';

describe('storefront planGate', () => {
  it('aponta o upgrade para /plans com a feature', () => {
    expect(storefrontUpgradePath).toBe('/plans?feature=storefront');
  });
});
