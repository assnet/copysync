import { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ChatWebSocketPublisher, type ChatWsEvent } from './ChatWebSocketPublisher';
import { RedisChatEventRelay } from './RedisChatEventRelay';

/**
 * Redis LOCAL descartável (`scripts/redis-descartavel.sh start`): INTEGRATION_REDIS_URL=redis://127.0.0.1:<porta>.
 * Sem a variável o arquivo é pulado; host fora de localhost é recusado.
 */
const url = process.env['INTEGRATION_REDIS_URL'];
if (url) {
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`INTEGRATION_REDIS_URL precisa apontar para localhost (recebido: ${host}).`);
  }
}

const clients: Redis[] = [];
afterAll(async () => {
  await Promise.all(clients.map((c) => c.quit()));
});

describe.skipIf(!url)('RedisChatEventRelay com Redis real', () => {
  it('evento publicado no worker chega ao WS do http; outro tenant não recebe', async () => {
    const command = new Redis(url!);
    const subscriber = new Redis(url!);
    clients.push(command, subscriber);

    const worker = new ChatWebSocketPublisher();
    worker.setRelay(new RedisChatEventRelay({ mode: 'publish', client: command }));

    const http = new ChatWebSocketPublisher();
    const ws = { readyState: 1, send: vi.fn() } as unknown as WebSocket & { send: ReturnType<typeof vi.fn> };
    const otherTenant = { readyState: 1, send: vi.fn() } as unknown as WebSocket & { send: ReturnType<typeof vi.fn> };
    const tenantId = `int-${Date.now()}`;
    http.subscribe(tenantId, ws);
    http.subscribe(`${tenantId}-b`, otherTenant);
    const relay = new RedisChatEventRelay({
      mode: 'deliver',
      client: subscriber,
      deliver: (t, p) => http.deliverLocal(t, p),
    });
    await relay.start();

    const event: ChatWsEvent = { event: 'chat.unread.updated', data: { tenantId, conversationId: 'c1', unreadCount: 3 } };
    worker.publish(tenantId, event);

    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledWith(JSON.stringify(event)), { timeout: 3000 });
    expect(otherTenant.send).not.toHaveBeenCalled();
    await relay.stop();
  });
});
