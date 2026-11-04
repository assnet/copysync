import { EventEmitter } from 'node:events';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import type { ChatWsEvent } from './ChatWebSocketPublisher';
import { RedisChatEventRelay } from './RedisChatEventRelay';

const event: ChatWsEvent = { event: 'chat.session.updated', data: { tenantId: 't1', sessionId: 's1', status: 'CONNECTED' } };

function fakeClient() {
  const em = new EventEmitter() as EventEmitter & Record<string, ReturnType<typeof vi.fn>>;
  em.publish = vi.fn(async () => 1);
  em.psubscribe = vi.fn(async () => 1);
  em.punsubscribe = vi.fn(async () => 0);
  return em;
}

describe('RedisChatEventRelay', () => {
  it('publish: PUBLISH no canal do tenant; falha não lança', async () => {
    const client = fakeClient();
    const relay = new RedisChatEventRelay({ mode: 'publish', client: client as unknown as Redis });
    relay.publish('t1', event);
    expect(client.publish).toHaveBeenCalledWith('tenant:t1', JSON.stringify(event));
    client.publish.mockRejectedValueOnce(new Error('down'));
    expect(() => relay.publish('t1', event)).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });

  it('deliver: assina tenant:* uma vez, entrega por tenant, descarta lixo e para no stop', async () => {
    const client = fakeClient();
    const deliver = vi.fn();
    const relay = new RedisChatEventRelay({ mode: 'deliver', client: client as unknown as Redis, deliver });
    await relay.start();
    await relay.start();
    expect(client.psubscribe).toHaveBeenCalledTimes(1);
    expect(client.psubscribe).toHaveBeenCalledWith('tenant:*');
    client.emit('pmessage', 'tenant:*', 'tenant:t9', JSON.stringify(event));
    client.emit('pmessage', 'tenant:*', 'tenant:t9', '{nao-json');
    client.emit('pmessage', 'outro:*', 'outro:t9', JSON.stringify(event));
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith('t9', event);
    await relay.stop();
    client.emit('pmessage', 'tenant:*', 'tenant:t9', JSON.stringify(event));
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(client.punsubscribe).toHaveBeenCalledWith('tenant:*');
  });

  it('modo errado lança', async () => {
    const client = fakeClient() as unknown as Redis;
    expect(() => new RedisChatEventRelay({ mode: 'deliver', client, deliver: vi.fn() }).publish('t1', event)).toThrow();
    await expect(new RedisChatEventRelay({ mode: 'publish', client }).start()).rejects.toThrow();
  });
});
