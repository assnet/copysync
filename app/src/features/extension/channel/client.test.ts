import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChannelEnvelope } from '../contract/channel';

const proxy = vi.hoisted(() => ({
  ids: [] as string[],
  send: vi.fn(async (_id: string, env: ChannelEnvelope, _t: number): Promise<ChannelEnvelope | undefined> => ({
    ...env, direction: 'response', payload: { ok: true, payload: { extVersion: '3.3.0' } },
  })),
}));
vi.mock('./proxyTransport', () => ({ readProxyIds: () => proxy.ids, sendViaProxy: proxy.send }));

type Cb = (r: unknown) => void;
const g = globalThis as { chrome?: unknown };

async function load() {
  vi.resetModules();
  vi.stubEnv('VITE_EXTENSION_IDS', 'ext-store,ext-dev');
  return import('./client');
}

beforeEach(() => {
  proxy.ids = [];
  proxy.send.mockClear();
  delete g.chrome;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete g.chrome;
});

describe('client — fallback para o proxy', () => {
  it('sem chrome.runtime (Orion) usa o proxy e guarda o transporte', async () => {
    proxy.ids = ['ext-store'];
    const c = await load();
    expect(c.isExtensionApiAvailable()).toBe(true);
    await expect(c.detectExtension()).resolves.toBe(true);
    expect(proxy.send).toHaveBeenCalledWith('ext-store', expect.objectContaining({ op: 'handshake' }), 3_000);
    expect(c.getCachedTransport()).toBe('proxy');
    expect(c.getCachedExtId()).toBe('ext-store');
  });

  it('externally_connectable mudo: desiste em 1,5 s e repete pelo proxy com requestId novo', async () => {
    vi.useFakeTimers();
    const sent: ChannelEnvelope[] = [];
    g.chrome = { runtime: { sendMessage: (_id: string, env: ChannelEnvelope, _cb: Cb) => void sent.push(env) } };
    proxy.ids = ['ext-store'];
    const c = await load();
    const p = c.sendOp('handshake');
    await vi.advanceTimersByTimeAsync(3_000);
    const r = await p;
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(2);
    const viaProxy = proxy.send.mock.calls[0][1];
    expect(sent.map((e) => e.requestId)).not.toContain(viaProxy.requestId);
    expect(c.getCachedTransport()).toBe('proxy');
  });

  it('externally_connectable falhando (lastError) cai no proxy', async () => {
    const runtime: { lastError?: { message: string }; sendMessage: (id: string, env: unknown, cb: Cb) => void } = {
      sendMessage: (_id, _env, cb) => { runtime.lastError = { message: 'x' }; cb(undefined); runtime.lastError = undefined; },
    };
    g.chrome = { runtime };
    proxy.ids = ['ext-store'];
    const c = await load();
    await expect(c.sendOp('ml.status')).resolves.toMatchObject({ ok: true });
    expect(proxy.send).toHaveBeenCalledOnce();
  });

  it('externo respondendo não toca no proxy', async () => {
    g.chrome = {
      runtime: {
        sendMessage: (_id: string, env: ChannelEnvelope, cb: Cb) =>
          cb({ ...env, direction: 'response', payload: { ok: true, payload: {} } }),
      },
    };
    proxy.ids = ['ext-store'];
    const c = await load();
    await expect(c.sendOp('handshake')).resolves.toMatchObject({ ok: true });
    expect(proxy.send).not.toHaveBeenCalled();
    expect(c.getCachedTransport()).toBe('external');
  });

  it('proxy de id fora de VITE_EXTENSION_IDS é ignorado', async () => {
    proxy.ids = ['ext-estranha'];
    const c = await load();
    expect(c.isExtensionApiAvailable()).toBe(false);
    await expect(c.sendOp('handshake')).resolves.toEqual({ ok: false, error: { code: 'INTERNAL' } });
    expect(proxy.send).not.toHaveBeenCalled();
  });

  it('marcador do proxy conta como canal ligado (detecção do fluxo de instalação)', async () => {
    const c = await load();
    expect(c.isExtensionChannelBound()).toBe(false);
    proxy.ids = ['ext-dev'];
    expect(c.isExtensionChannelBound()).toBe(true);
  });
});
