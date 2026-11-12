import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { perTenantRateLimit, rateLimitPresets } from '../../../../shared/http/rateLimitPresets';
import { hunterContainer } from '../../infrastructure/hunterContainer';
import type { OfferHuntDefinitionInput } from '../../application/use-cases/hunter/OfferHuntCrudUseCases';
import { offerHunterAudienceHook, isOfferHunterVisible } from '../hooks/offerHunterAudienceHook';
import { OfferHuntPresenter as P } from '../presenters/OfferHuntPresenter';
import {
  accessResponse, approveFindResponse, createHuntBodySchema, findIdParamSchema, findResponse, findsPageResponse,
  huntIdParamSchema, huntListResponse, huntResponse, optionsResponse, pageQuerySchema, runResultResponse,
  runsPageResponse, settingsBodySchema, settingsResponse, updateHuntBodySchema, usageResponse,
} from '../schemas/offerHunt.schema';

const preHandler = [authHook, tenantHook, offerHunterAudienceHook];
const tags = ['Offer Hunter'];

type IdParams = { Params: { id: string } };
type FindParams = { Params: { findId: string } };
type PageQuery = { Querystring: { cursor?: string } };

/**
 * Caçador de Ofertas, em /api/offer-hunts. Toda rota (menos `/access`) leva auth + tenant + portão de
 * audiência; papéis como no gerador (qualquer membro do tenant). Use cases fazem a regra; presenters fecham
 * os campos (sem token, `memberId`, credencial nem posse do job). Paths estáticos antes de `/:id`.
 */
export async function offerHuntRoutes(app: FastifyInstance): Promise<void> {
  const c = hunterContainer;

  app.get(
    '/access',
    { preHandler: [authHook], schema: { tags, summary: 'O caçador aparece para este usuário/tenant (nunca 403)', response: { 200: accessResponse } } },
    async (request, reply) => {
      httpResponse.ok(reply, { visible: await isOfferHunterVisible(request) });
    },
  );

  app.get(
    '/usage',
    { preHandler, schema: { tags, summary: 'Ofertas garimpadas hoje frente ao teto e execuções do dia', response: { 200: usageResponse } } },
    async (request, reply) => {
      httpResponse.ok(reply, await c.getOfferHunterUsage().execute(request.tenantContext.tenantId));
    },
  );

  app.get(
    '/options',
    { preHandler, schema: { tags, summary: 'Categorias, ordenações, faixas, predefinições e portões', response: { 200: optionsResponse } } },
    async (request, reply) => {
      httpResponse.ok(reply, await c.getOfferHunterOptions().execute(request.tenantContext.tenantId));
    },
  );

  app.get(
    '/settings',
    { preHandler, schema: { tags, summary: 'Grupo de destino do caçador', response: { 200: settingsResponse } } },
    async (request, reply) => {
      httpResponse.ok(reply, await c.getOfferHunterDestination().execute(request.tenantContext.tenantId));
    },
  );

  app.put<{ Body: { sessionId: string; conversationId: string } }>(
    '/settings',
    { preHandler, schema: { tags, summary: 'Salvar grupo de destino', body: settingsBodySchema, response: { 200: settingsResponse } } },
    async (request, reply) => {
      const saved = await c.setOfferHunterDestination().execute({ tenantId: request.tenantContext.tenantId, ...request.body });
      httpResponse.ok(reply, P.settings(saved));
    },
  );

  app.post<FindParams>(
    '/finds/:findId/approve',
    { preHandler, schema: { tags, summary: 'Aprovar achado e enviar ao grupo', params: findIdParamSchema, response: { 200: approveFindResponse } } },
    async (request, reply) => {
      const out = await c.approveHuntFind().execute({ tenantId: request.tenantContext.tenantId, findId: request.params.findId });
      httpResponse.ok(reply, P.approved(out));
    },
  );

  app.post<FindParams>(
    '/finds/:findId/dismiss',
    { preHandler, schema: { tags, summary: 'Dispensar achado', params: findIdParamSchema, response: { 200: findResponse } } },
    async (request, reply) => {
      const find = await c.dismissHuntFind().execute({ tenantId: request.tenantContext.tenantId, findId: request.params.findId });
      httpResponse.ok(reply, P.find(find));
    },
  );

  app.get(
    '/',
    { preHandler, schema: { tags, summary: 'Caçadas do tenant', response: { 200: huntListResponse } } },
    async (request, reply) => {
      httpResponse.ok(reply, (await c.listOfferHunts().execute(request.tenantContext.tenantId)).map(P.hunt));
    },
  );

  app.post<{ Body: OfferHuntDefinitionInput }>(
    '/',
    { preHandler, schema: { tags, summary: 'Criar caçada (máx. 5 por tenant)', body: createHuntBodySchema, response: { 201: huntResponse } } },
    async (request, reply) => {
      const hunt = await c.createOfferHunt().execute({ tenantId: request.tenantContext.tenantId, definition: request.body });
      httpResponse.created(reply, P.hunt(hunt));
    },
  );

  app.get<IdParams>(
    '/:id',
    { preHandler, schema: { tags, summary: 'Caçada', params: huntIdParamSchema, response: { 200: huntResponse } } },
    async (request, reply) => {
      httpResponse.ok(reply, P.hunt(await c.getOfferHunt().execute({ tenantId: request.tenantContext.tenantId, huntId: request.params.id })));
    },
  );

  app.put<IdParams & { Body: OfferHuntDefinitionInput }>(
    '/:id',
    { preHandler, schema: { tags, summary: 'Editar caçada', params: huntIdParamSchema, body: updateHuntBodySchema, response: { 200: huntResponse } } },
    async (request, reply) => {
      const hunt = await c.updateOfferHunt().execute({ tenantId: request.tenantContext.tenantId, huntId: request.params.id, definition: request.body });
      httpResponse.ok(reply, P.hunt(hunt));
    },
  );

  app.delete<IdParams>(
    '/:id',
    { preHandler, schema: { tags, summary: 'Excluir caçada (histórico fica)', params: huntIdParamSchema } },
    async (request, reply) => {
      await c.deleteOfferHunt().execute({ tenantId: request.tenantContext.tenantId, huntId: request.params.id });
      httpResponse.noContent(reply);
    },
  );

  app.post<IdParams>(
    '/:id/pause',
    { preHandler, schema: { tags, summary: 'Pausar caçada', params: huntIdParamSchema, response: { 200: huntResponse } } },
    async (request, reply) => {
      httpResponse.ok(reply, P.hunt(await c.pauseOfferHunt().execute({ tenantId: request.tenantContext.tenantId, huntId: request.params.id })));
    },
  );

  app.post<IdParams>(
    '/:id/resume',
    { preHandler, schema: { tags, summary: 'Retomar caçada', params: huntIdParamSchema, response: { 200: huntResponse } } },
    async (request, reply) => {
      httpResponse.ok(reply, P.hunt(await c.resumeOfferHunt().execute({ tenantId: request.tenantContext.tenantId, huntId: request.params.id })));
    },
  );

  app.post<IdParams>(
    '/:id/run',
    {
      // Array próprio: o rate-limit anexa o hook ao `preHandler` da rota; no compartilhado valeria para todas
      preHandler: [...preHandler],
      config: { rateLimit: perTenantRateLimit(rateLimitPresets.offerHuntRun) },
      schema: { tags, summary: 'Executar agora (ranking com pontuação e fatores)', params: huntIdParamSchema, response: { 200: runResultResponse } },
    },
    async (request, reply) => {
      const out = await c.runOfferHunt().execute({
        tenantId: request.tenantContext.tenantId, huntId: request.params.id, trigger: 'MANUAL', now: new Date(),
      });
      httpResponse.ok(reply, P.runResult(out));
    },
  );

  app.get<IdParams & PageQuery>(
    '/:id/runs',
    { preHandler, schema: { tags, summary: 'Histórico de execuções (cursor)', params: huntIdParamSchema, querystring: pageQuerySchema, response: { 200: runsPageResponse } } },
    async (request, reply) => {
      const page = await c.listOfferHuntRuns().execute({ tenantId: request.tenantContext.tenantId, huntId: request.params.id, cursor: request.query.cursor });
      httpResponse.ok(reply, P.runsPage(page));
    },
  );

  app.get<IdParams & PageQuery>(
    '/:id/finds',
    { preHandler, schema: { tags, summary: 'Achados da caçada (cursor)', params: huntIdParamSchema, querystring: pageQuerySchema, response: { 200: findsPageResponse } } },
    async (request, reply) => {
      const page = await c.listOfferHuntFinds().execute({ tenantId: request.tenantContext.tenantId, huntId: request.params.id, cursor: request.query.cursor });
      httpResponse.ok(reply, P.findsPage(page));
    },
  );
}
