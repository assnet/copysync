import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { superAdminHook } from '../../../../shared/http/hooks/superAdminHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { linkRotationContainer } from '../../infrastructure/linkRotationContainer';
import type { LinkDomainStatus } from '../../domain/enums/LinkRotationEnums';
import { LinkDomainPresenter } from '../presenters/LinkRotationPresenter';
import {
  createLinkDomainBodySchema,
  linkDomainIdParamSchema,
  linkDomainListResponse,
  linkDomainProbeResponse,
  linkDomainResponse,
  createPremiumGrantBodySchema,
  premiumGrantListResponse,
  premiumGrantParamSchema,
  premiumGrantResponse,
  updateLinkDomainBodySchema,
} from '../schemas/linkDomainAdmin.schema';

const preHandler = [authHook, superAdminHook];
const tags = ['Link domains (admin)'];
const uc = () => linkRotationContainer.adminUseCases();

type IdParams = { Params: { id: string } };
type CreateBody = { hostname: string; landingUrl?: string | null; reservedNames?: string[]; premiumNames?: string[] };
type UpdateBody = { status?: LinkDomainStatus; landingUrl?: string | null; reservedNames?: string[]; premiumNames?: string[] };
type GrantBody = { tenantId: string; slug: string; expiresAt?: string | null };
type GrantParams = { Params: { id: string; grantId: string } };

/** Super admin: domínios base do rodízio de links. Registrado em `/api/admin/link-domains`. */
export async function linkDomainAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', {
    preHandler,
    schema: { tags, summary: 'Listar domínios de links', response: { 200: linkDomainListResponse } },
  }, async (_request, reply) => {
    const items = await uc().list.execute();
    httpResponse.ok(reply, { items: items.map(LinkDomainPresenter.domain) });
  });

  app.post<{ Body: CreateBody }>('/', {
    preHandler,
    schema: { tags, summary: 'Cadastrar domínio de links', body: createLinkDomainBodySchema, response: { 201: linkDomainResponse } },
  }, async (request, reply) => {
    httpResponse.created(reply, LinkDomainPresenter.domain(await uc().create.execute(request.body)));
  });

  app.patch<IdParams & { Body: UpdateBody }>('/:id', {
    preHandler,
    schema: {
      tags,
      summary: 'Status, landing (null remove), nomes reservados e especiais',
      params: linkDomainIdParamSchema,
      body: updateLinkDomainBodySchema,
      response: { 200: linkDomainResponse },
    },
  }, async (request, reply) => {
    const domain = await uc().update.execute({ ...request.body, id: request.params.id });
    httpResponse.ok(reply, LinkDomainPresenter.domain(domain));
  });

  app.delete<IdParams>('/:id', {
    preHandler,
    schema: { tags, summary: 'Excluir domínio sem rodízios', params: linkDomainIdParamSchema },
  }, async (request, reply) => {
    await uc().delete.execute(request.params.id);
    httpResponse.noContent(reply);
  });

  app.post<IdParams>('/:id/probe', {
    preHandler,
    schema: {
      tags,
      summary: 'Testar DNS wildcard, certificado e roteamento do domínio',
      params: linkDomainIdParamSchema,
      response: { 200: linkDomainProbeResponse },
    },
  }, async (request, reply) => {
    httpResponse.ok(reply, LinkDomainPresenter.probe(await uc().probe.execute({ id: request.params.id })));
  });

  app.get<IdParams>('/:id/premium-grants', {
    preHandler,
    schema: { tags, summary: 'Listar liberações de nomes especiais', params: linkDomainIdParamSchema, response: { 200: premiumGrantListResponse } },
  }, async (request, reply) => {
    const items = await uc().listGrants.execute(request.params.id);
    httpResponse.ok(reply, { items: items.map(LinkDomainPresenter.grant) });
  });

  app.post<IdParams & { Body: GrantBody }>('/:id/premium-grants', {
    preHandler,
    schema: {
      tags,
      summary: 'Liberar nome especial para um tenant',
      params: linkDomainIdParamSchema,
      body: createPremiumGrantBodySchema,
      response: { 201: premiumGrantResponse },
    },
  }, async (request, reply) => {
    const grant = await uc().grant.execute({ ...request.body, domainId: request.params.id, actorUserId: request.user.userId });
    httpResponse.created(reply, LinkDomainPresenter.grant(grant));
  });

  app.delete<GrantParams>('/:id/premium-grants/:grantId', {
    preHandler,
    schema: { tags, summary: 'Revogar liberação de nome especial', params: premiumGrantParamSchema },
  }, async (request, reply) => {
    await uc().revoke.execute({ domainId: request.params.id, grantId: request.params.grantId, actorUserId: request.user.userId });
    httpResponse.noContent(reply);
  });
}
