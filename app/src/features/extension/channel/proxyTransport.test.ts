import { describe, it, expect, vi, afterEach } from 'vitest';
import { CHANNEL_NAME, PROXY_DIRECTION, PROXY_MARKER_ATTR, type ChannelEnvelope } from '../contract/channel';
import { readProxyIds, sendViaProxy, type ProxyMessageEventLike, type ProxyWindowLike } from './proxyTransport';

const ORIGIN = 'https://app.test';
const EXT = 'ext-a';

const req: ChannelEnvelope = { channel: CHANNEL_NAME, version: 1, direction: 'request', requestId: 'r1', timestamp: 1, op: 'handshake', payload: {} };
const resEnv = (requestId = 'r1'): ChannelEnvelope => ({ ...req, direction: 'response', requestId, op: '', payload: { ok: true, payload: {} } });

function fakeWin(marker: string | null = EXT) {
  const listeners = new Set<(ev: ProxyMessageEventLike) => void>();
  const posted: Array<{ msg: any; target: string }> = [];
  const win: ProxyWindowLike = {
    location: { origin: ORIGIN },
    document: { documentElement: { getAttribute: (n) => (n === PROXY_MARKER_ATTR ? marker : null) } },
    postMessage: (msg, target) => void posted.push({ msg, target }),
    addEventListener: (_t, fn) => void listeners.add(fn),
    removeEventListener: (_t, fn) => void listeners.delete(fn),
  };
  const emit = (data: unknown, over: Partial<ProxyMessageEventLike> = {}) =>
    [...listeners].forEach((fn) => fn({ source: win, origin: ORIGIN, data, ...over }));
  return { win, posted, emit, listeners };
}
const res = (over: Record<string, unknown> = {}) =>
  ({ channel: CHANNEL_NAME, direction: PROXY_DIRECTION, kind: 'res', from: EXT, requestId: 'r1', res: resEnv(), ...over });

afterEach(() => vi.useRealTimers());

describe('readProxyIds', () => {
  it('lê ids do marcador sem repetição', () => {
    expect(readProxyIds(fakeWin('a b  a').win)).toEqual(['a', 'b']);
    expect(readProxyIds(fakeWin(null).win)).toEqual([]);
  });
});

describe('sendViaProxy', () => {
  it('posta req com targetOrigin exato e resolve a resposta', async () => {
    const f = fakeWin();
    const p = sendViaProxy(EXT, req, 1000, f.win);
    expect(f.posted[0]).toEqual({ msg: { channel: CHANNEL_NAME, direction: PROXY_DIRECTION, kind: 'req', to: EXT, req }, target: ORIGIN });
    f.emit(res());
    await expect(p).resolves.toEqual(resEnv());
    expect(f.listeners.size).toBe(0);
  });

  it('ignora origem inválida, outro window, outra extensão e outro requestId', async () => {
    vi.useFakeTimers();
    const f = fakeWin();
    const p = sendViaProxy(EXT, req, 500, f.win);
    f.emit(res(), { origin: 'https://evil.example' });
    f.emit(res(), { source: {} });
    f.emit(res({ from: 'ext-b' }));
    f.emit(res({ requestId: 'r2', res: resEnv('r2') }));
    f.emit(res({ res: { ...resEnv(), direction: 'request' } }));
    vi.advanceTimersByTime(500);
    await expect(p).resolves.toBeUndefined();
  });

  it('fail do content script resolve undefined na hora', async () => {
    const f = fakeWin();
    const p = sendViaProxy(EXT, req, 10_000, f.win);
    f.emit({ channel: CHANNEL_NAME, direction: PROXY_DIRECTION, kind: 'fail', from: EXT, requestId: 'r1' });
    await expect(p).resolves.toBeUndefined();
  });
});
