import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { offersContainer } from '../../infrastructure/offersContainer';

const nullableString = { type: ['string', 'null'] } as const;
const channelMap = (value: object) => ({
  type: 'object',
  required: ['whatsapp', 'telegram'],
  properties: {
    whatsapp: { type: 'object', required: ['broadcastGroups'], properties: { broadcastGroups: value } },
    telegram: { type: 'object', required: ['broadcastGroups'], properties: { broadcastGroups: value } },
  },
});

// Lista fechada: o serializador descarta o que não estiver aqui (sem JID, sem texto de mensagem).
const listResponse = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              conversationId: { type: 'string' },
              sessionId: { type: 'string' },
              sessionName: { type: 'string' },
              channel: { type: 'string', enum: ['whatsapp', 'telegram'] },
              title: nullableString,
              avatarUrl: nullableString,
              usedBy: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        limits: channelMap({ type: ['number', 'null'] }),
        usage: channelMap({ type: 'integer', minimum: 0 }),
      },
    },
  },
} as const;

/**
 * Grupos de disparo do tenant (BG-04/BG-05): catálogo da união gerador ⋃ monitoramentos e remoção de todos os usos.
 * Registrado em /api/campaigns/broadcast-groups.
 */
export async function broadcastGroupsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    {
      preHandler: [authHook, tenantHook],
      schema: {
        tags: ['Offers'],
        summary: 'Grupos de disparo do tenant (gerador e monitoramentos), com uso e limite por canal',
        response: { 200: listResponse },
      },
    },
    async (request, reply) => {
      httpResponse.ok(reply, await offersContainer.listBroadcastGroups().execute(request.tenantContext.tenantId));
    },
  );

  app.delete<{ Params: { conversationId: string } }>(
    '/:conversationId',
    {
      preHandler: [authHook, tenantHook],
      schema: {
        tags: ['Offers'],
        summary: 'Tira o grupo do gerador e de todos os monitoramentos do tenant (idempotente)',
        params: {
          type: 'object',
          required: ['conversationId'],
          properties: { conversationId: { type: 'string', minLength: 1, maxLength: 64 } },
        },
        response: { 204: { type: 'null' } },
      },
    },
    async (request, reply) => {
      await offersContainer.removeBroadcastGroup().execute({
        tenantId: request.tenantContext.tenantId,
        conversationId: request.params.conversationId,
      });
      httpResponse.noContent(reply);
    },
  );
}
