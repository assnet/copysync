import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { offersContainer } from '../../infrastructure/offersContainer';
import type { OfferAudience } from '../../domain/enums/OfferAudience';
import {
  generateOfferBodySchema,
  generateOfferResponse,
  offerConfigResponse,
  offerIdParamSchema,
  offerResponse,
  offerUsageResponse,
  regenerateOfferBodySchema,
  regenerateOfferResponse,
  saveConfigBodySchema,
  sendOfferResponse,
  updateOfferBodySchema,
  ensureSessionGroupBodySchema,
  ensureSessionGroupResponse,
  sessionGroupsQuerySchema,
  sessionGroupsResponse,
} from '../schemas/offer.schema';
import type { OfferDispatchOrder } from '../../domain/entities/OfferGeneratorConfig';

const preHandler = [authHook, tenantHook];
const tags = ['Offers'];

type IdParams = { Params: { id: string } };
type UpdateBody = {
  title?: string | null;
  priceCents?: number | null;
  originalPriceCents?: number | null;
  text?: string;
  imageUploadId?: string;
  coupon?: string | null;
  audience?: OfferAudience;
  mentionAll?: boolean;
  simulateTyping?: boolean;
  typingSeconds?: number;
};
type GenerateBody = { url: string; coupon?: string | null; audience?: OfferAudience };
type SaveConfigBody = {
  sessionIds: string[];
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  dispatchOrder: OfferDispatchOrder;
  conversationIds: string[];
};

/**
 * Gerador de ofertas. Registrado em /api/campaigns/offers. Use cases já devolvem DTO (sem
 * credencial); o schema de resposta fecha os campos. Nunca logar o body (link e texto do operador).
 * Paths estáticos antes de `/:id`.
 */
export async function offerRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: GenerateBody }>(
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
      const { url, coupon, audience } = request.body;
      const result = await offersContainer.generateOffer().execute({ tenantId, userId, url, coupon, audience });
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
    '/config',
    { preHandler, schema: { tags, summary: 'Configuração do gerador (sessão, grupos, intervalo)', response: { 200: offerConfigResponse } } },
    async (request, reply) => {
      httpResponse.ok(reply, await offersContainer.getConfig().execute(request.tenantContext.tenantId));
    },
  );

  app.put<{ Body: SaveConfigBody }>(
    '/config',
    {
      preHandler,
      schema: {
        tags,
        summary: 'Salvar configuração do gerador',
        body: saveConfigBodySchema,
        response: { 200: offerConfigResponse },
      },
    },
    async (request, reply) => {
      const result = await offersContainer.saveConfig().execute({
        tenantId: request.tenantContext.tenantId,
        ...request.body,
      });
      httpResponse.ok(reply, result);
    },
  );

  app.get<{ Querystring: { sessionId: string; search?: string } }>(
    '/config/groups',
    {
      preHandler,
      schema: {
        tags,
        summary: 'Grupos de que a sessão participa no WhatsApp (busca por nome)',
        querystring: sessionGroupsQuerySchema,
        response: { 200: sessionGroupsResponse },
      },
    },
    async (request, reply) => {
      httpResponse.ok(reply, await offersContainer.listSessionGroups().execute({
        tenantId: request.tenantContext.tenantId,
        sessionId: request.query.sessionId,
        search: request.query.search,
      }));
    },
  );

  app.post<{ Body: { sessionId: string; groupJid: string } }>(
    '/config/groups/ensure',
    {
      preHandler,
      schema: {
        tags,
        summary: 'Garante a conversa do grupo escolhido como destino',
        body: ensureSessionGroupBodySchema,
        response: { 200: ensureSessionGroupResponse },
      },
    },
    async (request, reply) => {
      httpResponse.ok(reply, await offersContainer.ensureSessionGroup().execute({
        tenantId: request.tenantContext.tenantId,
        ...request.body,
      }));
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

  app.post<IdParams & { Body: { audience?: OfferAudience } | null }>(
    '/:id/regenerate',
    {
      preHandler,
      schema: {
        tags,
        summary: 'Gerar novamente o texto da oferta',
        params: offerIdParamSchema,
        body: regenerateOfferBodySchema,
        response: { 200: regenerateOfferResponse },
      },
    },
    async (request, reply) => {
      const result = await offersContainer.regenerateOfferText().execute({
        tenantId: request.tenantContext.tenantId,
        offerId: request.params.id,
        audience: request.body?.audience,
      });
      httpResponse.ok(reply, result);
    },
  );

  app.post<IdParams>(
    '/:id/send',
    {
      preHandler,
      schema: { tags, summary: 'Enfileirar envio para os grupos da configuração', params: offerIdParamSchema, response: { 202: sendOfferResponse } },
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
