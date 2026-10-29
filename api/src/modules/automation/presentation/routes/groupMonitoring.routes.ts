import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { automationContainer } from '../../infrastructure/automationContainer';
import type { GroupMonitorSettings } from '../../domain/entities/GroupMonitor';
import {
  capturedIdParamSchema, capturedListResponse, capturedQuerySchema, capturedResponse, configResponse,
  saveBroadcastBodySchema, saveMonitoredBodySchema, saveSettingsBodySchema, sessionQuerySchema,
} from '../schemas/groupMonitoring.schema';

const preHandler = [authHook, tenantHook];
const tags = ['Group monitoring'];

/**
 * Monitoramento de grupos. Registrado em /api/automation/group-monitoring. Handlers finos: validam
 * por schema e chamam o use case. Nunca logar o body (nomes de grupo, palavras-chave).
 */
export async function groupMonitoringRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { sessionId: string } }>(
    '/config',
    { preHandler, schema: { tags, summary: 'Configuração do monitoramento da sessão', querystring: sessionQuerySchema, response: { 200: configResponse } } },
    async (request, reply) => {
      const result = await automationContainer.getConfig().execute({ tenantId: request.tenantContext.tenantId, sessionId: request.query.sessionId });
      httpResponse.ok(reply, result);
    },
  );

  app.put<{ Body: Omit<GroupMonitorSettings, 'captureOutsideWindow'> & { captureOutsideWindow?: boolean; sessionId: string } }>(
    '/config',
    { preHandler, schema: { tags, summary: 'Salvar horário, envio e validade', body: saveSettingsBodySchema, response: { 200: configResponse } } },
    async (request, reply) => {
      // `captureOutsideWindow` ausente (cliente antigo): o use case mantém o valor salvo
      const { sessionId, ...settings } = request.body;
      const result = await automationContainer.saveSettings().execute({ tenantId: request.tenantContext.tenantId, sessionId, settings });
      httpResponse.ok(reply, result);
    },
  );

  app.put<{ Body: { sessionId: string; groups: { groupJid: string; keywords: string[] }[] } }>(
    '/config/monitored-groups',
    { preHandler, schema: { tags, summary: 'Substituir grupos monitorados', body: saveMonitoredBodySchema, response: { 200: configResponse } } },
    async (request, reply) => {
      const result = await automationContainer.saveMonitored().execute({ tenantId: request.tenantContext.tenantId, ...request.body });
      httpResponse.ok(reply, result);
    },
  );

  app.put<{ Body: { sessionId: string; groups: { groupJid: string; sessionId?: string | null }[] } }>(
    '/config/broadcast-groups',
    { preHandler, schema: { tags, summary: 'Substituir grupos de disparo (ordem = envio; grupo de outra sessão exige cross_session_dispatch)', body: saveBroadcastBodySchema, response: { 200: configResponse } } },
    async (request, reply) => {
      const result = await automationContainer.saveBroadcast().execute({ tenantId: request.tenantContext.tenantId, ...request.body });
      httpResponse.ok(reply, result);
    },
  );

  app.get<{ Querystring: { sessionId: string; cursor?: string } }>(
    '/captured',
    { preHandler, schema: { tags, summary: 'Ofertas capturadas da sessão', querystring: capturedQuerySchema, response: { 200: capturedListResponse } } },
    async (request, reply) => {
      const result = await automationContainer.listCaptured().execute({ tenantId: request.tenantContext.tenantId, ...request.query });
      httpResponse.ok(reply, result);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/captured/:id/retry',
    { preHandler, schema: { tags, summary: 'Processar a captura de novo', params: capturedIdParamSchema, response: { 200: capturedResponse } } },
    async (request, reply) => {
      const result = await automationContainer.retryCaptured().execute({ tenantId: request.tenantContext.tenantId, id: request.params.id });
      httpResponse.ok(reply, result);
    },
  );
}
