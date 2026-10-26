import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { superAdminHook } from '../../../../shared/http/hooks/superAdminHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { assistantsContainer } from '../../infrastructure/assistantsContainer';
import { AiPresenter } from '../presenters/AiPresenter';
import type { AiProviderKind } from '../../domain/enums/AiProviderKind';
import type { AiSettings } from '../../domain/entities/AiSettings';
import {
  aiCredentialResponse,
  aiProviderIdParamSchema,
  aiProviderListResponse,
  aiProviderResponse,
  aiSettingsBodySchema,
  aiSettingsResponse,
  aiStatusResponse,
  aiTestResponse,
  createAiProviderBodySchema,
  updateAiProviderBodySchema,
  upsertAiCredentialBodySchema,
} from '../schemas/ai.schema';

const tags = ['AI'];
const uc = () => assistantsContainer.useCases();

type ProviderFields = {
  label?: string;
  model?: string;
  apiKey?: string;
  enabled?: boolean;
  priority?: number;
  dailyLimitPerTenant?: number | null;
};
type IdParams = { Params: { id: string } };

/**
 * Super admin: modos de IA e provedores da plataforma. Registrado em /api/admin/ai.
 * Nenhuma resposta carrega chave; nunca logar o body destas rotas.
 */
export async function aiAdminRoutes(app: FastifyInstance): Promise<void> {
  const preHandler = [authHook, superAdminHook];

  app.get('/settings', {
    preHandler,
    schema: { tags, summary: 'Modos de IA da plataforma', response: { 200: aiSettingsResponse } },
  }, async (_request, reply) => {
    httpResponse.ok(reply, await uc().getSettings.execute());
  });

  app.put<{ Body: AiSettings }>('/settings', {
    preHandler,
    schema: {
      tags,
      summary: 'Atualizar modos de IA (pelo menos um ligado)',
      body: aiSettingsBodySchema,
      response: { 200: aiSettingsResponse },
    },
  }, async (request, reply) => {
    httpResponse.ok(reply, await uc().updateSettings.execute({ ...request.body, userId: request.user.userId }));
  });

  app.get('/providers', {
    preHandler,
    schema: { tags, summary: 'Listar provedores de IA da plataforma', response: { 200: aiProviderListResponse } },
  }, async (_request, reply) => {
    const items = await uc().listProviders.execute();
    httpResponse.ok(reply, { items: items.map(AiPresenter.provider) });
  });

  app.post<{ Body: ProviderFields & { kind: AiProviderKind; label: string; apiKey: string } }>('/providers', {
    preHandler,
    schema: {
      tags,
      summary: 'Cadastrar provedor de IA (chave só de escrita)',
      body: createAiProviderBodySchema,
      response: { 201: aiProviderResponse },
    },
  }, async (request, reply) => {
    const provider = await uc().createProvider.execute({ ...request.body, userId: request.user.userId });
    httpResponse.created(reply, AiPresenter.provider(provider));
  });

  app.patch<IdParams & { Body: ProviderFields }>('/providers/:id', {
    preHandler,
    schema: {
      tags,
      summary: 'Editar provedor de IA (chave vazia mantém a atual)',
      params: aiProviderIdParamSchema,
      body: updateAiProviderBodySchema,
      response: { 200: aiProviderResponse },
    },
  }, async (request, reply) => {
    const provider = await uc().updateProvider.execute({
      ...request.body,
      id: request.params.id,
      userId: request.user.userId,
    });
    httpResponse.ok(reply, AiPresenter.provider(provider));
  });

  app.delete<IdParams>('/providers/:id', {
    preHandler,
    schema: { tags, summary: 'Remover provedor de IA', params: aiProviderIdParamSchema },
  }, async (request, reply) => {
    await uc().deleteProvider.execute({ id: request.params.id, userId: request.user.userId });
    httpResponse.noContent(reply);
  });

  app.post<IdParams>('/providers/:id/test', {
    preHandler,
    schema: {
      tags,
      summary: 'Testar provedor com geração mínima',
      params: aiProviderIdParamSchema,
      response: { 200: aiTestResponse },
    },
  }, async (request, reply) => {
    httpResponse.ok(reply, await uc().testProvider.execute(request.params.id));
  });
}

/** Tenant: status da IA e chave própria. Registrado em /api/ai. */
export async function aiTenantRoutes(app: FastifyInstance): Promise<void> {
  const preHandler = [authHook, tenantHook];

  app.get('/status', {
    preHandler,
    schema: { tags, summary: 'Modo de IA efetivo do tenant', response: { 200: aiStatusResponse } },
  }, async (request, reply) => {
    httpResponse.ok(reply, await uc().status.execute(request.tenantContext.tenantId));
  });

  app.put<{ Body: { kind: AiProviderKind; model?: string; apiKey?: string; enabled?: boolean } }>('/credential', {
    preHandler,
    schema: {
      tags,
      summary: 'Cadastrar ou editar a chave de IA do tenant (chave vazia mantém a atual)',
      body: upsertAiCredentialBodySchema,
      response: { 200: aiCredentialResponse },
    },
  }, async (request, reply) => {
    const { tenantId, userId } = request.tenantContext;
    const credential = await uc().upsertCredential.execute({ ...request.body, tenantId, userId });
    httpResponse.ok(reply, AiPresenter.credential(credential));
  });

  app.delete('/credential', {
    preHandler,
    schema: { tags, summary: 'Remover a chave de IA do tenant' },
  }, async (request, reply) => {
    const { tenantId, userId } = request.tenantContext;
    await uc().deleteCredential.execute({ tenantId, userId });
    httpResponse.noContent(reply);
  });

  app.post('/credential/test', {
    preHandler,
    schema: { tags, summary: 'Testar a chave de IA do tenant', response: { 200: aiTestResponse } },
  }, async (request, reply) => {
    httpResponse.ok(reply, await uc().testCredential.execute(request.tenantContext.tenantId));
  });
}
