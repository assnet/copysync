import type { WebSocket } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { ChatWebSocketPublisher, type ChatWsEvent } from './ChatWebSocketPublisher';

const event: ChatWsEvent = { event: 'chat.presence.updated', data: { tenantId: 't1', phone: '55', presence: 'available' } };
const fakeWs = (readyState = 1) => ({ readyState, send: vi.fn() }) as unknown as WebSocket & { send: ReturnType<typeof vi.fn> };

describe('ChatWebSocketPublisher', () => {
  it('sem relay entrega só aos WS abertos do tenant', () => {
    const pub = new ChatWebSocketPublisher();
    const a = fakeWs();
    const closed = fakeWs(3);
    const other = fakeWs();
    pub.subscribe('t1', a);
    pub.subscribe('t1', closed);
    pub.subscribe('t2', other);
    pub.publish('t1', event);
    expect(a.send).toHaveBeenCalledWith(JSON.stringify(event));
    expect(closed.send).not.toHaveBeenCalled();
    expect(other.send).not.toHaveBeenCalled();
  });

  it('remove cliente cujo send lança; unsubscribe para de entregar', () => {
    const pub = new ChatWebSocketPublisher();
    const dead = fakeWs();
    dead.send.mockImplementation(() => { throw new Error('x'); });
    const ok = fakeWs();
    pub.subscribe('t1', dead);
    pub.subscribe('t1', ok);
    pub.publish('t1', event);
    pub.publish('t1', event);
    expect(dead.send).toHaveBeenCalledTimes(1);
    pub.unsubscribe('t1', ok);
    pub.publish('t1', event);
    expect(ok.send).toHaveBeenCalledTimes(2);
  });

  it('com relay publica só no relay; deliverLocal e pingAll seguem locais', () => {
    const pub = new ChatWebSocketPublisher();
    const ws = fakeWs();
    pub.subscribe('t1', ws);
    const relay = { publish: vi.fn() };
    pub.setRelay(relay);
    pub.publish('t1', event);
    expect(relay.publish).toHaveBeenCalledWith('t1', event);
    expect(ws.send).not.toHaveBeenCalled();
    pub.deliverLocal('t1', event);
    pub.pingAll();
    expect(ws.send.mock.calls).toEqual([[JSON.stringify(event)], [JSON.stringify({ event: 'ping' })]]);
    pub.setRelay(null);
    pub.publish('t1', event);
    expect(ws.send).toHaveBeenCalledTimes(3);
    expect(relay.publish).toHaveBeenCalledTimes(1);
  });
});
