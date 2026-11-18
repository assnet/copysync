import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { perTenantRateLimit, rateLimitPresets } from '../../../../shared/http/rateLimitPresets';
import { recordPageViewUseCase } from '../../infrastructure/featureUsageContainer';
import { pageViewBody } from '../schemas/featureUsage.schema';

/**
 * Visita de tela (P3, design §4.6). Rota da conta (classe `TENANT`, fora do gate de produto), registrada em
 * `/api/usage`. Grava no máximo uma marca por dia × conta × tela (`markOnce`); super admin não conta; conta suspensa
 * para no `tenantHook`. Limite de 60 por minuto por conta. Nada de usuário, URL ou IP é gravado. Sempre 204.
 */
export async function usagePageViewRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { key: string } }>('/page-views', {
    preHandler: [authHook, tenantHook],
    config: { rateLimit: perTenantRateLimit(rateLimitPresets.usagePageViews) },
    schema: {
      tags: ['Feature usage'],
      summary: 'Registra que a conta abriu uma tela do menu hoje (idempotente por dia × conta × tela)',
      body: pageViewBody,
      response: { 204: { type: 'null', description: 'Recebido.' } },
    },
  }, async (request, reply) => {
    const ctx = request.tenantContext;
    recordPageViewUseCase().execute({ tenantId: ctx.tenantId, isSuperAdmin: ctx.isSuperAdmin, key: request.body.key, at: new Date() });
    httpResponse.noContent(reply);
    return reply;
  });
}
