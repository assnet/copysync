import { describe, expect, it, vi } from 'vitest';
import {
  CachedChatEntitlementGate, CHAT_ENTITLEMENT_FALLBACK_TTL_MS, CHAT_ENTITLEMENT_KEY,
} from './CachedChatEntitlementGate';
import { logger } from '../../../../shared/logger/logger';

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

  it('falha de leitura = ligado, guardado por 10 s; relê depois', async () => {
    const { gate, getBoolean, advance } = make(new Error('db'));
    expect(await gate.isChatEnabled('t1')).toBe(true);
    expect(await gate.isChatEnabled('t1')).toBe(true);
    expect(getBoolean).toHaveBeenCalledTimes(1);
    advance(CHAT_ENTITLEMENT_FALLBACK_TTL_MS + 1);
    expect(await gate.isChatEnabled('t1')).toBe(true);
    expect(getBoolean).toHaveBeenCalledTimes(2);
  });

  it('leitura lenta: prazo = ligado, guardado por 10 s, um warn por janela', async () => {
    let t = 0;
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    const getBoolean = vi.fn(() => new Promise<boolean | null>(() => undefined));
    const gate = new CachedChatEntitlementGate({ getBoolean }, { now: () => t, readTimeoutMs: 20 });
    expect(await Promise.all([gate.isChatEnabled('t1'), gate.isChatEnabled('t1')])).toEqual([true, true]);
    expect(await gate.isChatEnabled('t1')).toBe(true);
    expect(getBoolean).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    t += CHAT_ENTITLEMENT_FALLBACK_TTL_MS + 1;
    expect(await gate.isChatEnabled('t1')).toBe(true);
    expect(getBoolean).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('falha após leitura bem-sucedida usa o último valor conhecido (desligado continua desligado)', async () => {
    let t = 0;
    let fail = false;
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    const getBoolean = vi.fn(async () => { if (fail) throw new Error('pool'); return false; });
    const gate = new CachedChatEntitlementGate({ getBoolean }, { ttlMs: 45_000, now: () => t });
    expect(await gate.isChatEnabled('t1')).toBe(false);
    fail = true;
    t += 45_001;
    expect(await gate.isChatEnabled('t1')).toBe(false);
    expect(await gate.isChatEnabled('t1')).toBe(false);
    expect(getBoolean).toHaveBeenCalledTimes(2);
    expect(await gate.isChatEnabled('t2')).toBe(true);
    warn.mockRestore();
  });
});
