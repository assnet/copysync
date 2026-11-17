import { describe, expect, it, vi } from 'vitest';
import { ProductAwareChatEntitlementGate } from './ProductAwareChatEntitlementGate';

describe('ProductAwareChatEntitlementGate', () => {
  it('produto CHAT inativo desliga sem consultar o entitlement', async () => {
    const inner = { isChatEnabled: vi.fn(async () => true) };
    const has = vi.fn(async () => false);
    expect(await new ProductAwareChatEntitlementGate({ has }, inner).isChatEnabled('t1')).toBe(false);
    expect(has).toHaveBeenCalledWith('t1', 'CHAT');
    expect(inner.isChatEnabled).not.toHaveBeenCalled();
  });

  it('produto ativo: decide o entitlement; sem gate de entitlement = ligado', async () => {
    const has = async () => true;
    expect(await new ProductAwareChatEntitlementGate({ has }, { isChatEnabled: async () => false }).isChatEnabled('t1')).toBe(false);
    expect(await new ProductAwareChatEntitlementGate({ has }).isChatEnabled('t1')).toBe(true);
  });
});
