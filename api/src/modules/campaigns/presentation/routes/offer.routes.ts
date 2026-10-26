import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { offersContainer } from '../../infrastructure/offersContainer';
import {
  generateOfferBodySchema,
  generateOfferResponse,
  offerDestinationsResponse,
  offerIdParamSchema,
  offerResponse,
  offerUsageResponse,
  replaceDestinationsBodySchema,
  sendOfferResponse,
  updateOfferBodySchema,
} from '../schemas/offer.schema';

const preHandler = [authHook, tenantHook];
const tags = ['Offers'];

type IdParams = { Params: { id: string } };
type UpdateBody = {
  title?: string | null;
  priceCents?: number | null;
  originalPriceCents?: number | null;
  text?: string;
  imageUploadId?: string;
};

/**
 * Gerador de ofertas. Registrado em /api/campaigns/offers. Use cases já devolvem DTO (sem
 * credencial); o schema de resposta fecha os campos. Nunca logar o body (link e texto do operador).
 * Paths estáticos antes de `/:id`.
 */
export async function offerRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { url: string } }>(
    '/',
    {
      preHandler,
      schema: {
        tags,
        summary: 'Gerar oferta a partir do link do produto',
        body: generateOfferBodySchema,
        response: { 201: generateOfferResponse },
      },
    },
    async (request, reply) => {
      const { tenantId, userId } = request.tenantContext;
      const result = await offersContainer.generateOffer().execute({ tenantId, userId, url: request.body.url });
      httpResponse.created(reply, result);
    },
  );

  app.get(
    '/usage',
    { preHandler, schema: { tags, summary: 'Ofertas geradas hoje frente ao limite do plano', response: { 200: offerUsageResponse } } },
    async (request, reply) => {
      httpResponse.ok(reply, await offersContainer.getOfferUsage().execute(request.tenantContext.tenantId));
    },
  );

  app.get(
    '/destinations',
    { preHandler, schema: { tags, summary: 'Listar destinos das ofertas', response: { 200: offerDestinationsResponse } } },
    async (request, reply) => {
      httpResponse.ok(reply, await offersContainer.listDestinations().execute(request.tenantContext.tenantId));
    },
  );

  app.put<{ Body: { conversationIds: string[] } }>(
    '/destinations',
    {
      preHandler,
      schema: {
        tags,
        summary: 'Substituir destinos das ofertas',
        body: replaceDestinationsBodySchema,
        response: { 200: offerDestinationsResponse },
      },
    },
    async (request, reply) => {
      const result = await offersContainer.replaceDestinations().execute({
        tenantId: request.tenantContext.tenantId,
        conversationIds: request.body.conversationIds,
      });
      httpResponse.ok(reply, result);
    },
  );

  app.get<IdParams>(
    '/:id',
    { preHandler, schema: { tags, summary: 'Oferta com o progresso dos envios', params: offerIdParamSchema, response: { 200: offerResponse } } },
    async (request, reply) => {
      const offer = await offersContainer.getOffer().execute({
        tenantId: request.tenantContext.tenantId,
        offerId: request.params.id,
      });
      httpResponse.ok(reply, offer);
    },
  );

  app.patch<IdParams & { Body: UpdateBody }>(
    '/:id',
    {
      preHandler,
      schema: {
        tags,
        summary: 'Editar oferta antes do envio',
        params: offerIdParamSchema,
        body: updateOfferBodySchema,
        response: { 200: offerResponse },
      },
    },
    async (request, reply) => {
      const { tenantId, userId } = request.tenantContext;
      const offer = await offersContainer.updateOffer().execute({
        tenantId,
        userId,
        offerId: request.params.id,
        ...request.body,
      });
      httpResponse.ok(reply, offer);
    },
  );

  app.post<IdParams>(
    '/:id/send',
    {
      preHandler,
      schema: { tags, summary: 'Enfileirar envio para os destinos', params: offerIdParamSchema, response: { 202: sendOfferResponse } },
    },
    async (request, reply) => {
      const result = await offersContainer.sendOffer().execute({
        tenantId: request.tenantContext.tenantId,
        offerId: request.params.id,
      });
      httpResponse.accepted(reply, result);
    },
  );
}
