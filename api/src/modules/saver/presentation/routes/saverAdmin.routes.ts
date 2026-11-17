import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { saverPlatformUseCases } from '../../infrastructure/saverContainer';
import type { PlatformSaverActor, PlatformSaverContactQuery } from '../../application/use-cases/PlatformSaverContactsUseCases';
import { SaverPresenter } from '../presenters/SaverPresenter';
import { saverSuperAdminHook } from '../hooks/saverSuperAdminHook';
import { sendSaverFile } from './saverHttp';
import {
  idParamSchema,
  platformContactResponse,
  platformContactsResponse,
  platformExportBodySchema,
  platformListQuerySchema,
  platformSummaryQuerySchema,
  platformSummaryResponse,
  platformTenantsQuerySchema,
  platformTenantsResponse,
} from '../schemas/saver.schema';

/*
 * Base de contatos da PLATAFORMA (SAVER-45), `/api/admin/saver`. Fora do gate de produto e da audiência; só super
 * admin (hook + use case). Lista por cursor assinado (sem `limit`/offset); consulta e exportação auditadas;
 * indicadores (`/contacts/summary`) são só contagem agregada, sem auditoria.
 */
const preHandler = [authHook, saverSuperAdminHook];
const tags = ['Saver (admin)'];

type Filters = { search?: string; tenantId?: string; from?: string; to?: string; ddi?: string; ddd?: string };

const actorOf = (request: FastifyRequest): PlatformSaverActor => ({
  userId: request.user.userId,
  isSuperAdmin: request.user.isSuperAdmin === true,
});

const toQuery = (f: Filters): PlatformSaverContactQuery => ({
  search: f.search ?? null,
  tenantId: f.tenantId ?? null,
  from: f.from ? new Date(f.from) : null,
  to: f.to ? new Date(f.to) : null,
  ddi: f.ddi ?? null,
  ddd: f.ddd ?? null,
});

export async function saverAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Filters & { cursor?: string } }>('/contacts', {
    preHandler,
    schema: { tags, summary: 'Contatos da base (cursor assinado, busca, tenant, período, DDI e DDD)', querystring: platformListQuerySchema, response: { 200: platformContactsResponse } },
  }, async (request, reply) => {
    const out = await saverPlatformUseCases.listContacts.execute({
      actor: actorOf(request),
      ...toQuery(request.query),
      cursor: request.query.cursor ?? null,
    });
    return reply.status(200).send({ success: true, data: SaverPresenter.platformContacts(out) });
  });

  // Registrada antes de `/contacts/:id`; rota estática tem prioridade no roteador de qualquer forma.
  app.get<{ Querystring: Filters }>('/contacts/summary', {
    preHandler,
    schema: { tags, summary: 'Indicadores da base: total, filtrados, com telefone, só LID, DDIs e DDDs mais comuns', querystring: platformSummaryQuerySchema, response: { 200: platformSummaryResponse } },
  }, async (request, reply) => {
    const out = await saverPlatformUseCases.contactsSummary.execute({ actor: actorOf(request), ...toQuery(request.query) });
    return reply.status(200).send({ success: true, data: SaverPresenter.platformSummary(out) });
  });

  app.get<{ Params: { id: string } }>('/contacts/:id', {
    preHandler,
    schema: { tags, summary: 'Extrações do contato: conta (id e nome), grupo, data e hora', params: idParamSchema, response: { 200: platformContactResponse } },
  }, async (request, reply) => {
    const out = await saverPlatformUseCases.getContact.execute({ actor: actorOf(request), contactId: request.params.id });
    return reply.status(200).send({ success: true, data: { contactId: out.contactId, links: out.links.map(SaverPresenter.platformContactLink) } });
  });

  app.get<{ Querystring: { cursor?: string } }>('/tenants', {
    preHandler,
    schema: { tags, summary: 'Contas com vínculo no Saver, para o filtro (cursor assinado)', querystring: platformTenantsQuerySchema, response: { 200: platformTenantsResponse } },
  }, async (request, reply) => {
    const out = await saverPlatformUseCases.listTenants.execute({ actor: actorOf(request), cursor: request.query.cursor ?? null });
    return reply.status(200).send({ success: true, data: SaverPresenter.platformTenants(out) });
  });

  app.post<{ Body: Filters }>('/exports', {
    preHandler,
    schema: { tags, summary: 'Exporta a base em CSV por stream (auditado)', body: platformExportBodySchema },
  }, async (request, reply) => {
    const file = await saverPlatformUseCases.exportContacts.execute({ actor: actorOf(request), ...toQuery(request.body ?? {}) });
    return sendSaverFile(reply, file);
  });
}
