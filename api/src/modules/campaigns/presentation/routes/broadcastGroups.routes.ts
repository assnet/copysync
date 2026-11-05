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
 * Grupos de disparo do tenant (BG-04): catálogo da união gerador ⋃ monitoramentos.
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
}
