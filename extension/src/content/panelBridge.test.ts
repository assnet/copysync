import { describe, it, expect, vi } from 'vitest';
import { CHANNEL_NAME, PROXY_DIRECTION, PROXY_MARKER_ATTR, PROXY_MAX_BYTES, type ChannelEnvelope } from '../contract/channel';
import { createPanelBridge, BRIDGE_RATE_LIMIT, type BridgeMessageEvent } from './panelBridge';

const ORIGIN = 'https://app.test.local';
const EXT = 'extid-aaaa';

const envelope = (requestId = 'r1', extra: Partial<ChannelEnvelope> = {}): ChannelEnvelope => ({
  channel: CHANNEL_NAME, version: 1, direction: 'request', requestId, timestamp: Date.now(), op: 'handshake', payload: {}, ...extra,
});
const response = (requestId: string): ChannelEnvelope => ({
  channel: CHANNEL_NAME, version: 1, direction: 'response', requestId, timestamp: Date.now(), op: '', payload: { ok: true, payload: {} },
});
const req = (requestId = 'r1', to = EXT, extra: Partial<ChannelEnvelope> = {}) =>
  ({ channel: CHANNEL_NAME, direction: PROXY_DIRECTION, kind: 'req', to, req: envelope(requestId, extra) });

function setup(opts: { send?: (m: ChannelEnvelope) => Promise<unknown>; id?: string | undefined; allowed?: (o: string) => boolean } = {}) {
  let listener: ((ev: BridgeMessageEvent) => void) | null = null;
  const posted: Array<{ msg: any; target: string }> = [];
  const attrs = new Map<string, string>();
  const win = {
    location: { origin: ORIGIN },
    postMessage: (msg: unknown, target: string) => posted.push({ msg, target }),
    addEventListener: (_t: 'message', fn: (ev: BridgeMessageEvent) => void) => { listener = fn; },
    removeEventListener: () => { listener = null; },
  };
  const doc = {
    documentElement: { getAttribute: (n: string) => attrs.get(n) ?? null, setAttribute: (n: string, v: string) => void attrs.set(n, v) },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  };
  const runtimeState = { id: 'id' in opts ? opts.id : EXT };
  const send = vi.fn(opts.send ?? (async (m: ChannelEnvelope) => response(m.requestId)));
  const bridge = createPanelBridge({
    win, doc, runtime: { get id() { return runtimeState.id; }, send },
    isAllowedOrigin: opts.allowed ?? ((o) => o === ORIGIN),
  });
  const dispatch = (data: unknown, over: Partial<BridgeMessageEvent> = {}) =>
    listener?.({ source: win, origin: ORIGIN, data, ...over });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { win, posted, attrs, send, dispatch, flush, bridge, runtimeState };
}

describe('createPanelBridge', () => {
  it('marca <html> e anuncia ready com targetOrigin exato', () => {
    const s = setup();
    expect(s.attrs.get(PROXY_MARKER_ATTR)).toBe(EXT);
    expect(s.posted[0]).toEqual({ msg: { channel: CHANNEL_NAME, direction: PROXY_DIRECTION, kind: 'ready', from: EXT }, target: ORIGIN });
  });

  it('repassa req ao service worker e devolve res', async () => {
    const s = setup();
    s.dispatch(req('r1'));
    await s.flush();
    expect(s.send).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r1', op: 'handshake' }));
    const res = s.posted.at(-1)!;
    expect(res.target).toBe(ORIGIN);
    expect(res.msg).toMatchObject({ kind: 'res', from: EXT, requestId: 'r1', res: { direction: 'response', requestId: 'r1' } });
  });

  it('rejeita origem fora da allowlist', async () => {
    const s = setup({ allowed: () => false });
    s.dispatch(req());
    await s.flush();
    expect(s.send).not.toHaveBeenCalled();
  });

  it('rejeita origem diferente da do próprio window', async () => {
    const s = setup({ allowed: () => true });
    s.dispatch(req(), { origin: 'https://evil.example' });
    await s.flush();
    expect(s.send).not.toHaveBeenCalled();
  });

  it('rejeita mensagem de outro window (iframe/opener)', async () => {
    const s = setup();
    s.dispatch(req(), { source: {} });
    await s.flush();
    expect(s.send).not.toHaveBeenCalled();
  });

  it('ignora formato inválido e req endereçado a outra extensão', async () => {
    const s = setup();
    s.dispatch({ channel: CHANNEL_NAME, direction: PROXY_DIRECTION, kind: 'req', to: EXT, req: { op: 'x' } });
    s.dispatch(req('r2', 'outra-ext'));
    s.dispatch('texto');
    s.dispatch({ ...req('r3'), direction: 'request' });
    await s.flush();
    expect(s.send).not.toHaveBeenCalled();
  });

  it('nunca repassa resposta que não é o envelope do pedido', async () => {
    const s = setup({ send: async () => ({ cookies: 'segredo' }) });
    s.dispatch(req('r1'));
    await s.flush();
    const last = s.posted.at(-1)!.msg;
    expect(last).toEqual({ channel: CHANNEL_NAME, direction: PROXY_DIRECTION, kind: 'fail', from: EXT, requestId: 'r1' });
    expect(JSON.stringify(s.posted)).not.toContain('segredo');
  });

  it('contexto invalidado → fail sem chamar o service worker', async () => {
    const s = setup();
    s.runtimeState.id = undefined;
    s.dispatch(req('r1'));
    await s.flush();
    expect(s.send).not.toHaveBeenCalled();
    expect(s.posted.at(-1)!.msg.kind).toBe('fail');
  });

  it('recusa pedido acima do teto e excesso por segundo', async () => {
    const s = setup();
    s.dispatch(req('big', EXT, { payload: { x: 'a'.repeat(PROXY_MAX_BYTES) } }));
    for (let i = 0; i <= BRIDGE_RATE_LIMIT; i++) s.dispatch(req(`r${i}`));
    await s.flush();
    expect(s.send).toHaveBeenCalledTimes(BRIDGE_RATE_LIMIT - 1);
    expect(s.posted.filter((p) => p.msg.kind === 'fail').length).toBe(3); // teto + 2 acima do limite
  });

  it('destroy para de ouvir', async () => {
    const s = setup();
    s.bridge.destroy();
    s.dispatch(req());
    await s.flush();
    expect(s.send).not.toHaveBeenCalled();
  });
});
