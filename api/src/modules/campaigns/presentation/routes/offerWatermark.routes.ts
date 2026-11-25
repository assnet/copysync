import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { offersContainer } from '../../infrastructure/offersContainer';
import type { OfferWatermarkActor } from '../../application/use-cases/offerWatermarkUseCaseDeps';
import type { UpdateOfferWatermarkSettingsInput } from '../../application/use-cases/UpdateOfferWatermarkSettingsUseCase';
import { isOfferWatermarkVisible, offerWatermarkAudienceHook } from '../hooks/offerWatermarkAudienceHook';
import { OfferWatermarkPresenter as P } from '../presenters/OfferWatermarkPresenter';
import {
  offerWatermarkAccessResponse,
  offerWatermarkResponse,
  setOfferWatermarkImageBodySchema,
  updateOfferWatermarkBodySchema,
} from '../schemas/offerWatermark.schema';

const preHandler = [authHook, tenantHook, offerWatermarkAudienceHook];
const tags = ['Offer Watermark'];
const c = offersContainer;

function actor(request: FastifyRequest): OfferWatermarkActor {
  const { tenantId, userId, role, isSuperAdmin } = request.tenantContext;
  return { tenantId, userId, role, isSuperAdmin };
}

/**
 * Marca d'água própria das ofertas, em /api/offer-watermark (spec IMG-05/06/07/12/14). Toda rota (menos
 * `/access`) leva auth + tenant + gate de produto + audiência (404 para quem está fora). Plano (403
 * `PLAN_FEATURE_UNAVAILABLE`) e papel (403 `FORBIDDEN`, operador só lê) ficam nos use cases.
 */
export async function offerWatermarkRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/access',
    { preHandler: [authHook], schema: { tags, summary: 'A marca d\'água aparece para este usuário/tenant (nunca 403)', response: { 200: offerWatermarkAccessResponse } } },
    async (request, reply) => {
      httpResponse.ok(reply, { visible: await isOfferWatermarkVisible(request) });
    },
  );

  app.get(
    '/',
    { preHandler, schema: { tags, summary: 'Marca d\'água do tenant (padrões, sem registro)', response: { 200: offerWatermarkResponse } } },
    async (request, reply) => {
      httpResponse.ok(reply, P.watermark(await c.getOfferWatermark().execute(actor(request))));
    },
  );

  app.put<{ Body: UpdateOfferWatermarkSettingsInput }>(
    '/',
    { preHandler, schema: { tags, summary: 'Salvar ajustes (parcial)', body: updateOfferWatermarkBodySchema, response: { 200: offerWatermarkResponse } } },
    async (request, reply) => {
      httpResponse.ok(reply, P.watermark(await c.updateOfferWatermarkSettings().execute(actor(request), request.body)));
    },
  );

  app.put<{ Body: { uploadId: string } }>(
    '/image',
    {
      preHandler,
      schema: { tags, summary: 'Logo a partir de um upload concluído (troca apaga o anterior)', body: setOfferWatermarkImageBodySchema, response: { 200: offerWatermarkResponse } },
    },
    async (request, reply) => {
      httpResponse.ok(reply, P.watermark(await c.setOfferWatermarkImage().execute(actor(request), request.body.uploadId)));
    },
  );

  app.delete(
    '/image',
    { preHandler, schema: { tags, summary: 'Remover o logo (texto e ajustes seguem)', response: { 200: offerWatermarkResponse } } },
    async (request, reply) => {
      httpResponse.ok(reply, P.watermark(await c.removeOfferWatermarkImage().execute(actor(request))));
    },
  );
}
