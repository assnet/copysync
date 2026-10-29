import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { linkRotationContainer } from '../../infrastructure/linkRotationContainer';
import type { LinkRotationStatus, LinkRotationStrategy } from '../../domain/enums/LinkRotationEnums';
import type { LinkRotationGroupSelectionDTO } from '../../application/use-cases/SelectLinkRotationGroupsUseCase';
import { LinkRotationPresenter } from '../presenters/LinkRotationPresenter';
import {
  createRotationBodySchema,
  groupCandidatesQuerySchema,
  groupCandidatesResponse,
  groupResponse,
  groupsResponse,
  overviewResponse,
  renameRotationBodySchema,
  rotationGroupParamSchema,
  rotationIdParamSchema,
  rotationResponse,
  saveGroupsBodySchema,
  statsResponse,
  updateRotationBodySchema,
} from '../schemas/linkRotation.schema';

const preHandler = [authHook, tenantHook];
const tags = ['Link rotation'];
const uc = () => linkRotationContainer.useCases();

type IdParams = { Params: { id: string } };
type CreateBody = { sessionId: string; domainId: string; slug: string; strategy?: LinkRotationStrategy; title?: string | null };
type UpdateBody = { status?: LinkRotationStatus; strategy?: LinkRotationStrategy; title?: string | null; sessionId?: string };

/**
 * Rodízio de links do tenant (design.md §4.4). Registrado em `/api/link-rotation`.
 * Erros de regra vêm dos use cases: 403 PLAN_LIMIT_REACHED (`meta.key/limit`),
 * 409 LINK_SLUG_TAKEN (`meta.suggestions`), 404 LINK_ROTATION_NOT_FOUND (inclui outro tenant).
 */
export async function linkRotationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', {
    preHandler,
    schema: { tags, summary: 'Rodízios, domínios, limites do plano e sessões', response: { 200: overviewResponse } },
  }, async (request, reply) => {
    const overview = await uc().overview.execute(request.tenantContext.tenantId);
    httpResponse.ok(reply, LinkRotationPresenter.overview(overview));
  });

  app.post<{ Body: CreateBody }>('/', {
    preHandler,
    schema: { tags, summary: 'Criar rodízio de links', body: createRotationBodySchema, response: { 201: rotationResponse } },
  }, async (request, reply) => {
    const rotation = await uc().create.execute({ ...request.body, tenantId: request.tenantContext.tenantId });
    httpResponse.created(reply, LinkRotationPresenter.rotation(rotation));
  });

  app.patch<IdParams & { Body: UpdateBody }>('/:id', {
    preHandler,
    schema: {
      tags,
      summary: 'Pausar/retomar, estratégia, título ou sessão (trocar a sessão limpa os grupos)',
      params: rotationIdParamSchema,
      body: updateRotationBodySchema,
      response: { 200: rotationResponse },
    },
  }, async (request, reply) => {
    const rotation = await uc().update.execute({
      ...request.body,
      tenantId: request.tenantContext.tenantId,
      rotationId: request.params.id,
    });
    httpResponse.ok(reply, LinkRotationPresenter.rotation(rotation));
  });

  app.post<IdParams & { Body: { slug: string; domainId?: string } }>('/:id/rename', {
    preHandler,
    schema: {
      tags,
      summary: 'Trocar o nome do link (o antigo fica reservado por 30 dias)',
      params: rotationIdParamSchema,
      body: renameRotationBodySchema,
      response: { 200: rotationResponse },
    },
  }, async (request, reply) => {
    const rotation = await uc().rename.execute({
      ...request.body,
      tenantId: request.tenantContext.tenantId,
      rotationId: request.params.id,
    });
    httpResponse.ok(reply, LinkRotationPresenter.rotation(rotation));
  });

  app.delete<IdParams>('/:id', {
    preHandler,
    schema: { tags, summary: 'Excluir rodízio (nome reservado por 30 dias)', params: rotationIdParamSchema },
  }, async (request, reply) => {
    await uc().delete.execute(request.tenantContext.tenantId, request.params.id);
    httpResponse.noContent(reply);
  });

  app.get<IdParams & { Querystring: { search?: string } }>('/:id/groups', {
    preHandler,
    schema: {
      tags,
      summary: 'Grupos da sessão do rodízio para escolher (inclui os já selecionados)',
      params: rotationIdParamSchema,
      querystring: groupCandidatesQuerySchema,
      response: { 200: groupCandidatesResponse },
    },
  }, async (request, reply) => {
    httpResponse.ok(reply, await uc().groupCandidates.execute({
      tenantId: request.tenantContext.tenantId,
      rotationId: request.params.id,
      search: request.query.search,
    }));
  });

  app.put<IdParams & { Body: { groups: LinkRotationGroupSelectionDTO[] } }>('/:id/groups', {
    preHandler,
    schema: {
      tags,
      summary: 'Substituir os grupos do rodízio (conversa ou JID do grupo da sessão)',
      params: rotationIdParamSchema,
      body: saveGroupsBodySchema,
      response: { 200: groupsResponse },
    },
  }, async (request, reply) => {
    const groups = await uc().selectGroups.execute({
      tenantId: request.tenantContext.tenantId,
      rotationId: request.params.id,
      groups: request.body.groups,
    });
    httpResponse.ok(reply, { groups: groups.map(LinkRotationPresenter.group) });
  });

  app.post<{ Params: { id: string; gid: string } }>('/:id/groups/:gid/refresh', {
    preHandler,
    schema: {
      tags,
      summary: 'Buscar de novo o link e os membros do grupo',
      params: rotationGroupParamSchema,
      response: { 200: groupResponse },
    },
  }, async (request, reply) => {
    const group = await uc().refreshGroup.execute({
      tenantId: request.tenantContext.tenantId,
      rotationId: request.params.id,
      groupId: request.params.gid,
    });
    httpResponse.ok(reply, LinkRotationPresenter.group(group));
  });

  app.get<IdParams>('/:id/stats', {
    preHandler,
    schema: {
      tags,
      summary: 'Cliques totais e dos últimos 7 dias, por grupo',
      params: rotationIdParamSchema,
      response: { 200: statsResponse },
    },
  }, async (request, reply) => {
    const stats = await uc().stats.execute(request.tenantContext.tenantId, request.params.id);
    httpResponse.ok(reply, LinkRotationPresenter.stats(stats));
  });
}
