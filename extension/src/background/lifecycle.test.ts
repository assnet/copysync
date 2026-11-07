import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiFetch = vi.fn();
vi.mock('./apiFetch.js', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

let storage: Record<string, unknown>;
const setUninstallURL = vi.fn(async () => undefined);

beforeEach(() => {
  vi.resetModules();
  apiFetch.mockReset();
  setUninstallURL.mockClear();
  storage = {};
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'ext-id-test',
      getManifest: () => ({ version: '3.3.0' }),
      setUninstallURL,
    },
    storage: {
      local: {
        get: async (key: string) => (key in storage ? { [key]: storage[key] } : {}),
        set: async (items: Record<string, unknown>) => { Object.assign(storage, items); },
        remove: async (key: string) => { delete storage[key]; },
      },
    },
  });
});

const load = async () => ({
  store: await import('./store.js'),
  lifecycle: await import('./lifecycle.js'),
});
// Mesma instância de módulo que lifecycle.ts usa (resetModules por teste).
const syncError = async (code: string, detail?: string) => {
  const { SyncError } = await import('./errors.js');
  return new SyncError(code as never, detail);
};

describe('ensureInstallation', () => {
  it('é idempotente e single-flight (chamadas concorrentes → mesmo id)', async () => {
    const { store } = await load();
    const [a, b, c] = await Promise.all([
      store.ensureInstallation(),
      store.ensureInstallation(),
      store.ensureInstallation(),
    ]);
    expect(a.installationId).toBeTruthy();
    expect(b.installationId).toBe(a.installationId);
    expect(c.installationId).toBe(a.installationId);
    expect(a.extensionId).toBe('ext-id-test');
    expect((await store.ensureInstallation()).installationId).toBe(a.installationId);
  });

  it('mantém instalação existente', async () => {
    storage.installation = { installationId: 'existing', extensionId: 'x' };
    const { store } = await load();
    expect((await store.ensureInstallation()).installationId).toBe('existing');
  });
});

describe('sendLifecycleEvent', () => {
  it('INSTALL cria a instalação e envia body com extensionId e dedupeKey INSTALL', async () => {
    apiFetch.mockResolvedValue({ created: true });
    const { lifecycle, store } = await load();
    await lifecycle.sendLifecycleEvent('INSTALL');
    const inst = await store.getInstallation();
    expect(apiFetch).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/extension/lifecycle/event',
      body: {
        installationId: inst!.installationId,
        type: 'INSTALL',
        version: '3.3.0',
        channel: 'cs-ext',
        dedupeKey: 'INSTALL',
        extensionId: 'ext-id-test',
      },
    });
    expect(storage.lifecyclePending).toBeUndefined();
  });

  it('UPDATE usa UPDATE:<versão> e previousVersion', async () => {
    apiFetch.mockResolvedValue({});
    const { lifecycle } = await load();
    await lifecycle.sendLifecycleEvent('UPDATE', '3.2.2');
    expect(apiFetch.mock.calls[0][0].body).toMatchObject({ dedupeKey: 'UPDATE:3.3.0', previousVersion: '3.2.2' });
  });

  it('INSTALL com falha de rede fica pendente e é reenviado/limpo no flush', async () => {
    apiFetch.mockRejectedValueOnce(await syncError('api_unreachable', 'offline'));
    const { lifecycle } = await load();
    await lifecycle.sendLifecycleEvent('INSTALL');
    expect(storage.lifecyclePending).toMatchObject({ type: 'INSTALL', dedupeKey: 'INSTALL' });

    apiFetch.mockRejectedValueOnce(await syncError('api_unreachable', 'offline'));
    await lifecycle.flushPendingLifecycle();
    expect(storage.lifecyclePending).toBeDefined();

    apiFetch.mockResolvedValueOnce({ created: true });
    await lifecycle.flushPendingLifecycle();
    expect(apiFetch).toHaveBeenCalledTimes(3);
    expect(apiFetch.mock.calls[2][0].body).toMatchObject({ type: 'INSTALL', dedupeKey: 'INSTALL' });
    expect(storage.lifecyclePending).toBeUndefined();
  });

  it('erro definitivo (4xx) não deixa pendente', async () => {
    apiFetch.mockRejectedValueOnce(await syncError('api_rejected', 'HTTP 400'));
    const { lifecycle } = await load();
    await lifecycle.sendLifecycleEvent('INSTALL');
    expect(storage.lifecyclePending).toBeUndefined();
  });

  it('STARTUP com falha não fica pendente', async () => {
    apiFetch.mockRejectedValueOnce(await syncError('api_unreachable'));
    const { lifecycle } = await load();
    await lifecycle.sendLifecycleEvent('STARTUP');
    expect(storage.lifecyclePending).toBeUndefined();
  });
});

describe('setupUninstallUrl', () => {
  it('cria a instalação e define a URL com i/e/v', async () => {
    const { lifecycle, store } = await load();
    await lifecycle.setupUninstallUrl();
    const inst = await store.getInstallation();
    expect(setUninstallURL).toHaveBeenCalledWith(
      `https://app.test.local/extension-removed?i=${inst!.installationId}&e=ext-id-test&v=3.3.0`,
    );
  });
});
