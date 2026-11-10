import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubChrome, type ChromeStub } from '../__mocks__/chromeStub';

const focusOrOpenPanel = vi.fn(async () => undefined);
const runSync = vi.fn(async () => ({ status: 'ok' }));
vi.mock('./panelTab.js', () => ({ focusOrOpenPanel: () => focusOrOpenPanel() }));
vi.mock('./syncSession.js', () => ({ runSync: (...a: unknown[]) => runSync(...(a as [])) }));

let chromeStub: ChromeStub;

beforeEach(() => {
  vi.resetModules();
  focusOrOpenPanel.mockClear();
  runSync.mockClear();
  chromeStub = stubChrome();
});

const load = async () => ({
  click: await import('./actionClick.js'),
  store: await import('./store.js'),
});

describe('handleActionClick', () => {
  it('sem pendência só foca o painel', async () => {
    const { click, store } = await load();
    await store.getPendingAccess();
    await click.handleActionClick();
    expect(chromeStub.request).not.toHaveBeenCalled();
    expect(focusOrOpenPanel).toHaveBeenCalledTimes(1);
    expect(runSync).not.toHaveBeenCalled();
  });

  it('pendência vencida só foca o painel', async () => {
    const { click, store } = await load();
    await store.setPendingAccess({ marketplace: 'shein', until: Date.now() - 1 });
    await click.handleActionClick();
    expect(chromeStub.request).not.toHaveBeenCalled();
    expect(focusOrOpenPanel).toHaveBeenCalledTimes(1);
  });

  it('com pendência pede a permissão síncrono; concedida limpa, sincroniza e foca', async () => {
    const { click, store } = await load();
    await store.setPendingAccess({ marketplace: 'shein', until: Date.now() + 60_000 });
    const done = click.handleActionClick();
    // Pedido antes de qualquer await (gesto do usuário).
    expect(chromeStub.request).toHaveBeenCalledWith({ origins: ['https://m.shein.com/*'] });
    await done;
    expect(await store.getPendingAccess()).toBeNull();
    expect(runSync).toHaveBeenCalledWith('manual', 'shein');
    expect(focusOrOpenPanel).toHaveBeenCalledTimes(1);
  });

  it('negada limpa a pendência e foca sem sincronizar', async () => {
    chromeStub.request.mockResolvedValue(false);
    const { click, store } = await load();
    await store.setPendingAccess({ marketplace: 'shein', until: Date.now() + 60_000 });
    await click.handleActionClick();
    expect(await store.getPendingAccess()).toBeNull();
    expect(runSync).not.toHaveBeenCalled();
    expect(focusOrOpenPanel).toHaveBeenCalledTimes(1);
  });

  it('concedida registra a origem (estado pós-grant)', async () => {
    const { click, store } = await load();
    await store.setPendingAccess({ marketplace: 'shein', until: Date.now() + 60_000 });
    await click.handleActionClick();
    expect(chromeStub.granted.has('https://m.shein.com/*')).toBe(true);
    const { hasHostPermission } = await import('./marketplaceSession.js');
    expect(await hasHostPermission('shein')).toBe(true);
  });

  it('worker recém-acordado (espelho não lido): sem await antes do pedido, foca e mantém a pendência', async () => {
    chromeStub.storage.pendingAccess = { marketplace: 'shein', until: Date.now() + 60_000 };
    const { click, store } = await load();
    expect(store.peekPendingAccess()).toBeUndefined();
    await click.handleActionClick();
    expect(chromeStub.request).not.toHaveBeenCalled();
    expect(focusOrOpenPanel).toHaveBeenCalledTimes(1);
    expect(chromeStub.storage.pendingAccess).toBeDefined();

    // Próximo clique, espelho já carregado (boot do worker): pede no gesto.
    await store.getPendingAccess();
    const done = click.handleActionClick();
    expect(chromeStub.request).toHaveBeenCalledTimes(1);
    await done;
  });

  it('recusa por falta de gesto mantém a pendência', async () => {
    chromeStub.request.mockRejectedValue(new Error('This function must be called during a user gesture'));
    const { click, store } = await load();
    await store.setPendingAccess({ marketplace: 'shein', until: Date.now() + 60_000 });
    await click.handleActionClick();
    expect(chromeStub.request).toHaveBeenCalledTimes(1);
    expect(await store.getPendingAccess()).not.toBeNull();
    expect(focusOrOpenPanel).toHaveBeenCalledTimes(1);
  });

  it('pendência vencida sai do storage quando lida', async () => {
    chromeStub.storage.pendingAccess = { marketplace: 'shein', until: Date.now() - 1 };
    const { store } = await load();
    expect(await store.getPendingAccess()).toBeNull();
    expect(chromeStub.storage.pendingAccess).toBeUndefined();
    expect(store.peekPendingAccess()).toBeNull();
  });
});
