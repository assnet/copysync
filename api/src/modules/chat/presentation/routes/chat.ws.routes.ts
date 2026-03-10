import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { SocketStream } from '@fastify/websocket';
import { sseAuthHook } from '../../../../shared/http/hooks/sseAuthHook';
import { chatWsPublisher } from '../../infrastructure/ws/ChatWebSocketPublisher';
import { logger } from '../../../../shared/logger/logger';

/**
 * WebSocket gateway for the Chat module.
 *
 * Endpoint: GET /api/chat/ws?token=<jwt>&tenantId=<id>
 *
 * - Auth is handled by sseAuthHook (reads token/tenantId from query string)
 * - On connect: subscribes the socket to the tenant channel
 * - On close:   unsubscribes and cleans up
 * - Keepalive:  sends a JSON ping every 25 s to prevent proxy timeouts
 *
 * All real-time events are pushed by ChatWebSocketPublisher via `chatWsPublisher.publish()`.
 *
 * NOTE: @fastify/websocket v8 (Fastify v4 compatible) exposes a SocketStream
 * duplex stream; the underlying WebSocket is at `connection.socket`.
 */
export async function chatWsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/ws',
    {
      websocket: true,
      preHandler: [sseAuthHook],
    },
    function wsHandler(connection: SocketStream, request: FastifyRequest): void {
      const { tenantId } = request.tenantContext;
      const { socket } = connection;

      chatWsPublisher.subscribe(tenantId, socket);
      logger.debug({ tenantId }, 'Chat WS client connected');

      // Keepalive ping every 25 s
      const keepalive = setInterval(() => {
        if (socket.readyState === 1 /* OPEN */) {
          socket.send(JSON.stringify({ event: 'ping' }));
        }
      }, 25_000);

      socket.on('close', () => {
        clearInterval(keepalive);
        chatWsPublisher.unsubscribe(tenantId, socket);
        logger.debug({ tenantId }, 'Chat WS client disconnected');
      });

      socket.on('error', (err: Error) => {
        logger.warn({ err, tenantId }, 'Chat WS socket error');
        clearInterval(keepalive);
        chatWsPublisher.unsubscribe(tenantId, socket);
      });

      // Client messages are intentionally ignored in this version.
      // The WebSocket channel is server-push only.
    },
  );
}
