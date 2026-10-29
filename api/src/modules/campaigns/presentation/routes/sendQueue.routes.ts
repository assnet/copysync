import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { offersContainer } from '../../infrastructure/offersContainer';
import { sendQueueQuerySchema, sendQueueResponse, sendingPauseResponse } from '../schemas/sendQueue.schema';

/**
 * Fila de envio (docs/fila-de-envio.md). Registrado em /api/campaigns/send-queue. Leitura da fila
 * e pausa GLOBAL de envios do tenant; pausar/retomar/parar uma oferta continuam nas rotas da oferta.
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

  app.post(
    '/pause',
    { preHandler: [authHook, tenantHook], schema: { tags: ['Offers'], summary: 'Pausar todos os envios da conta (captura continua)', response: { 200: sendingPauseResponse } } },
    async (request, reply) => {
      httpResponse.ok(reply, await offersContainer.pauseAllSends().execute({ tenantId: request.tenantContext.tenantId }));
    },
  );

  app.post(
    '/resume',
    { preHandler: [authHook, tenantHook], schema: { tags: ['Offers'], summary: 'Retomar os envios da conta (fila compactada, sem rajada)', response: { 200: sendingPauseResponse } } },
    async (request, reply) => {
      httpResponse.ok(reply, await offersContainer.resumeAllSends().execute({ tenantId: request.tenantContext.tenantId }));
    },
  );
}
