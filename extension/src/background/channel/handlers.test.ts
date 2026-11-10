import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubChrome, type ChromeStub } from '../../__mocks__/chromeStub';

let chromeStub: ChromeStub;

beforeEach(() => {
  vi.resetModules();
  chromeStub = stubChrome();
});

const call = async (op: string) => {
  const { getHandler } = await import('./handlers.js');
  return getHandler(op)!({}, null);
};

describe('handlers Shein', () => {
  it('handshake anuncia ml.session e shein.session', async () => {
    const res = await call('handshake');
    expect(res).toMatchObject({ ok: true, payload: { caps: ['ml.session', 'shein.session'] } });
  });

  it('shein.requestAccess grava pendência de 10 min sem pedir permissão', async () => {
    const before = Date.now();
    const res = await call('shein.requestAccess');
    expect(res).toMatchObject({ ok: true, payload: { pending: true, permission: 'missing' } });
    const pending = chromeStub.storage.pendingAccess as { marketplace: string; until: number };
    expect(pending.marketplace).toBe('shein');
    expect(pending.until - before).toBeGreaterThanOrEqual(10 * 60 * 1000);
    expect(chromeStub.request).not.toHaveBeenCalled();
    expect(await call('shein.status')).toMatchObject({ payload: { pending: true, permission: 'missing' } });
  });

  it('shein.requestAccess com permissão já concedida não deixa pendência', async () => {
    chromeStub.granted.add('https://m.shein.com/*');
    const res = await call('shein.requestAccess');
    expect(res).toMatchObject({ payload: { pending: false, permission: 'granted' } });
    expect(chromeStub.storage.pendingAccess).toBeUndefined();
  });
});
