import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubChrome, type ChromeStub } from '../__mocks__/chromeStub';

let chromeStub: ChromeStub;

beforeEach(() => {
  vi.resetModules();
  chromeStub = stubChrome();
});

const future = () => Date.now() + 60_000;

describe('getPendingAccess: corrida com set/clear', () => {
  it('set durante a leitura não é sobrescrito pelo valor velho', async () => {
    chromeStub.storage.pendingAccess = { marketplace: 'shein', until: future() };
    const store = await import('./store.js');
    const reading = store.getPendingAccess();
    const fresh = { marketplace: 'shein' as const, until: future() + 1 };
    void store.setPendingAccess(fresh);
    await reading;
    expect(store.peekPendingAccess()).toEqual(fresh);
  });

  it('clear durante a leitura mantém o espelho vazio', async () => {
    chromeStub.storage.pendingAccess = { marketplace: 'shein', until: future() };
    const store = await import('./store.js');
    const reading = store.getPendingAccess();
    void store.clearPendingAccess();
    expect(await reading).toBeNull();
    expect(store.peekPendingAccess()).toBeNull();
  });

  it('sem corrida, a leitura carrega o espelho', async () => {
    const stored = { marketplace: 'shein' as const, until: future() };
    chromeStub.storage.pendingAccess = stored;
    const store = await import('./store.js');
    expect(store.peekPendingAccess()).toBeUndefined();
    expect(await store.getPendingAccess()).toEqual(stored);
    expect(store.peekPendingAccess()).toEqual(stored);
  });
});
