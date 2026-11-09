import { describe, expect, it, vi } from 'vitest';
import { CachedChatEntitlementGate, CHAT_ENTITLEMENT_KEY } from './CachedChatEntitlementGate';

function make(value: boolean | null | Error) {
  let t = 0;
  const getBoolean = vi.fn(async () => { if (value instanceof Error) throw value; return value; });
  const gate = new CachedChatEntitlementGate({ getBoolean }, { ttlMs: 45_000, now: () => t });
  return { gate, getBoolean, advance: (ms: number) => { t += ms; } };
}

describe('CachedChatEntitlementGate', () => {
  it('lê chat_enabled; true libera', async () => {
    const { gate, getBoolean } = make(true);
    expect(await gate.isChatEnabled('t1')).toBe(true);
    expect(getBoolean).toHaveBeenCalledWith('t1', CHAT_ENTITLEMENT_KEY);
  });

  it('ausente (null) ou false = desligado', async () => {
    expect(await make(null).gate.isChatEnabled('t1')).toBe(false);
    expect(await make(false).gate.isChatEnabled('t1')).toBe(false);
  });

  it('cache por tenant dentro do TTL; relê depois', async () => {
    const { gate, getBoolean, advance } = make(true);
    await gate.isChatEnabled('t1');
    await gate.isChatEnabled('t1');
    expect(getBoolean).toHaveBeenCalledTimes(1);
    await gate.isChatEnabled('t2');
    expect(getBoolean).toHaveBeenCalledTimes(2);
    advance(45_001);
    await gate.isChatEnabled('t1');
    expect(getBoolean).toHaveBeenCalledTimes(3);
  });

  it('leituras simultâneas do mesmo tenant consultam uma vez', async () => {
    const { gate, getBoolean } = make(true);
    await Promise.all([gate.isChatEnabled('t1'), gate.isChatEnabled('t1'), gate.isChatEnabled('t1')]);
    expect(getBoolean).toHaveBeenCalledTimes(1);
  });

  it('falha de leitura = ligado (comportamento de hoje) e não fica no cache', async () => {
    const { gate, getBoolean } = make(new Error('db'));
    expect(await gate.isChatEnabled('t1')).toBe(true);
    expect(await gate.isChatEnabled('t1')).toBe(true);
    expect(getBoolean).toHaveBeenCalledTimes(2);
  });
});
