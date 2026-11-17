import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { saverContainer, saverTenantUseCases } from '../../infrastructure/saverContainer';
import type { SaverExportFormat } from '../../domain/enums/SaverEnums';
import type { SaverExportOptions } from '../../domain/services/exportFormatters';
import { SaverPresenter } from '../presenters/SaverPresenter';
import { isSaverVisible, saverAudienceHook } from '../hooks/saverAudienceHook';
import { saverActorOf, sendSaverFile } from './saverHttp';
import {
  accessResponse,
  cancelExtractionResponse,
  configResponse,
  exportBodySchema,
  extractionResponse,
  grantResponse,
  grantsResponse,
  groupsResponse,
  idParamSchema,
  overviewResponse,
  requestExtractionBodySchema,
  sessionGroupsResponse,
  sessionParamSchema,
  setExportGrantBodySchema,
  updateConfigBodySchema,
  userParamSchema,
} from '../schemas/saver.schema';

/*
 * Saver do tenant (design §4.5). Registrado com `withProduct('SAVER', …)` em `/api/saver`: o gate de produto entra
 * logo após o `tenantHook` e o `saverAudienceHook` vem depois dele. Permissão (papel + liberação) só nos use cases.
 * Nenhuma resposta JSON traz nome, telefone ou LID de contato: só contagens; contatos saem só no arquivo.
 */
const preHandler = [authHook, tenantHook, saverAudienceHook];
const tags = ['Saver'];

type IdParams = { Params: { id: string } };
type ExportBody = { format: SaverExportFormat; groupIds: string[] | 'all'; options?: SaverExportOptions };
type ConfigBody = { namePrefix?: string | null; excludeAdminsByDefault?: boolean; defaultFormat?: SaverExportFormat; autoRefresh?: boolean };

export async function saverRoutes(app: FastifyInstance): Promise<void> {
  // Só `authHook`: fora do gate (exceção em `UNGATED_PRODUCT_ROUTE_EXCEPTIONS`), nunca 403.
  app.get('/access', {
    preHandler: [authHook],
    schema: { tags, summary: 'Se o item Saver aparece no menu (audiência do produto)', response: { 200: accessResponse } },
  }, async (request, reply) => {
    return reply.status(200).send({ success: true, data: { visible: await isSaverVisible(request) } });
  });

  app.get('/overview', {
    preHandler,
    schema: { tags, summary: 'Limites, uso, permissões efetivas e configuração', response: { 200: overviewResponse } },
  }, async (request, reply) => {
    const out = await saverContainer.getOverview.execute(saverActorOf(request));
    return reply.status(200).send({ success: true, data: SaverPresenter.overview(out) });
  });

  app.get<{ Params: { sessionId: string } }>('/sessions/:sessionId/groups', {
    preHandler,
    schema: { tags, summary: 'Grupos da sessão WhatsApp conectada, com marca de já salvo', params: sessionParamSchema, response: { 200: sessionGroupsResponse } },
  }, async (request, reply) => {
    const out = await saverContainer.listSessionGroups.execute(saverActorOf(request), { sessionId: request.params.sessionId });
    return reply.status(200).send({ success: true, data: out.map(SaverPresenter.sessionGroup) });
  });

  app.post<{ Body: { sessionId: string; groupJids: string[] } }>('/extractions', {
    preHandler,
    schema: { tags, summary: 'Pede a leitura dos grupos (fila por sessão)', body: requestExtractionBodySchema, response: { 201: extractionResponse } },
  }, async (request, reply) => {
    const out = await saverContainer.requestExtraction.execute(saverActorOf(request), request.body);
    return reply.status(201).send({ success: true, data: SaverPresenter.extraction(out) });
  });

  app.get<IdParams>('/extractions/:id', {
    preHandler,
    schema: { tags, summary: 'Progresso da extração', params: idParamSchema, response: { 200: extractionResponse } },
  }, async (request, reply) => {
    const out = await saverContainer.getExtraction.execute(saverActorOf(request), { extractionId: request.params.id });
    return reply.status(200).send({ success: true, data: SaverPresenter.extraction(out) });
  });

  app.post<IdParams>('/extractions/:id/cancel', {
    preHandler,
    schema: { tags, summary: 'Cancela os grupos ainda na fila', params: idParamSchema, response: { 200: cancelExtractionResponse } },
  }, async (request, reply) => {
    const out = await saverContainer.cancelExtraction.execute(saverActorOf(request), { extractionId: request.params.id });
    return reply.status(200).send({ success: true, data: SaverPresenter.cancelled(out) });
  });

  app.get('/groups', {
    preHandler,
    schema: { tags, summary: 'Grupos salvos com contagens (nunca linha de contato)', response: { 200: groupsResponse } },
  }, async (request, reply) => {
    const out = await saverContainer.listGroups.execute(saverActorOf(request));
    return reply.status(200).send({ success: true, data: out.map(SaverPresenter.group) });
  });

  app.delete<IdParams>('/groups/:id', {
    preHandler,
    schema: { tags, summary: 'Remove o grupo salvo (lógico)', params: idParamSchema },
  }, async (request, reply) => {
    await saverContainer.removeGroup.execute(saverActorOf(request), { groupId: request.params.id });
    return reply.status(204).send();
  });

  app.get('/permissions', {
    preHandler,
    schema: { tags, summary: 'Operadores e liberação de exportar (só ADMIN)', response: { 200: grantsResponse } },
  }, async (request, reply) => {
    const out = await saverTenantUseCases.listExportGrants.execute(saverActorOf(request));
    return reply.status(200).send({ success: true, data: out.map(SaverPresenter.exportGrant) });
  });

  app.put<{ Params: { userId: string }; Body: { export: boolean } }>('/permissions/:userId', {
    preHandler,
    schema: { tags, summary: 'Liga/desliga a liberação de exportar de um operador (auditado)', params: userParamSchema, body: setExportGrantBodySchema, response: { 200: grantResponse } },
  }, async (request, reply) => {
    const out = await saverTenantUseCases.setExportGrant.execute({
      actor: saverActorOf(request),
      targetUserId: request.params.userId,
      canExport: request.body.export,
    });
    return reply.status(200).send({ success: true, data: out });
  });

  app.post<{ Body: ExportBody }>('/exports', {
    preHandler,
    schema: { tags, summary: 'Exporta os contatos dos grupos (CSV ou vCard por stream, auditado)', body: exportBodySchema },
  }, async (request, reply) => {
    const file = await saverTenantUseCases.exportSavedContacts.execute({ actor: saverActorOf(request), ...request.body });
    return sendSaverFile(reply, file);
  });

  app.get('/config', {
    preHandler,
    schema: { tags, summary: 'Configuração do Saver do tenant', response: { 200: configResponse } },
  }, async (request, reply) => {
    const out = await saverTenantUseCases.getConfig.execute(saverActorOf(request));
    return reply.status(200).send({ success: true, data: SaverPresenter.config(out) });
  });

  app.put<{ Body: ConfigBody }>('/config', {
    preHandler,
    schema: { tags, summary: 'Salva a configuração (só ADMIN)', body: updateConfigBodySchema, response: { 200: configResponse } },
  }, async (request, reply) => {
    const out = await saverTenantUseCases.updateConfig.execute({ actor: saverActorOf(request), ...request.body });
    return reply.status(200).send({ success: true, data: SaverPresenter.config(out) });
  });
}
