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

  it('espelho já carregado vence a leitura do storage (escrita ainda na fila)', async () => {
    chromeStub.storage.pendingAccess = null;
    const store = await import('./store.js');
    await store.getPendingAccess(); // carrega o espelho (null)
    // Escrita presa: o storage continua com o valor velho enquanto a leitura acontece
    let release!: () => void;
    const local = (globalThis as unknown as { chrome: { storage: { local: { set: (i: Record<string, unknown>) => Promise<void> } } } }).chrome.storage.local;
    const realSet = local.set;
    local.set = (items) => new Promise<void>((res) => { release = () => { void realSet(items).then(res); }; });
    const fresh = { marketplace: 'shein' as const, until: future() };
    void store.setPendingAccess(fresh);
    expect(await store.getPendingAccess()).toEqual(fresh);
    expect(chromeStub.storage.pendingAccess).toBeNull(); // prova que a escrita ainda não rodou
    release?.();
  });

  it('cold start com pendência vencida: some do storage', async () => {
    chromeStub.storage.pendingAccess = { marketplace: 'shein', until: Date.now() - 1 };
    const store = await import('./store.js');
    expect(await store.getPendingAccess()).toBeNull();
    await vi.waitFor(() => expect('pendingAccess' in chromeStub.storage && chromeStub.storage.pendingAccess).toBeFalsy());
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
