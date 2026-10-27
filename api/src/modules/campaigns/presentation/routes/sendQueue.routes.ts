import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { offersContainer } from '../../infrastructure/offersContainer';
import { sendQueueQuerySchema, sendQueueResponse } from '../schemas/sendQueue.schema';

/**
 * Fila de envio (docs/fila-de-envio.md). Registrado em /api/campaigns/send-queue. Só leitura:
 * pausar/retomar/parar continuam nas rotas da oferta.
 */
export async function sendQueueRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { sessionId?: string } }>(
    '/',
    {
      preHandler: [authHook, tenantHook],
      schema: {
        tags: ['Offers'],
        summary: 'Fila de envio por sessão: enviando, aguardando e concluídos hoje',
        querystring: sendQueueQuerySchema,
        response: { 200: sendQueueResponse },
      },
    },
    async (request, reply) => {
      const result = await offersContainer.getSendQueue().execute({
        tenantId: request.tenantContext.tenantId,
        sessionId: request.query.sessionId,
      });
      httpResponse.ok(reply, result);
    },
  );
}
