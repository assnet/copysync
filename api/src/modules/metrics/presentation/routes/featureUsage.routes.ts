import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { superAdminHook } from '../../../../shared/http/hooks/superAdminHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import {
  getFeatureUsageDetailUseCase,
  getFeatureUsageSummaryUseCase,
  listFeatureUsageTenantsUseCase,
} from '../../infrastructure/featureUsageContainer';
import {
  type UsageQuerystring,
  type UsageSummaryQuerystring,
  resolveUsageQuery,
  usageFeatureDetailResponse,
  usageFeatureParams,
  usageQuery,
  usageSummaryQuery,
  usageSummaryResponse,
  usageTenantsQuery,
  usageTenantsResponse,
} from '../schemas/featureUsage.schema';
import {
  presentFeatureUsageDetail,
  presentFeatureUsageSummary,
  presentFeatureUsageTenants,
} from '../presenters/featureUsagePresenter';

const preHandler = [authHook, superAdminHook];
const tags = ['Feature usage (admin)'];

/**
 * Super admin: uso dos recursos (`.specs/features/usage-metrics`). Registrado em `/api/admin/usage`.
 * Só contagens por conta e recurso; nome de conta só na lista de contas de um recurso. Uma leitura de uso por
 * processo: a simultânea espera a vaga em fila curta (4) dentro do orçamento de 2 s; fila cheia ou prazo vencido
 * responde 503 `USAGE_METRICS_READ_UNAVAILABLE`.
 */
export async function featureUsageRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: UsageSummaryQuerystring }>('/summary', {
    preHandler,
    schema: {
      tags,
      summary: 'Uso dos recursos no período (padrão 30 dias): contas ativas, ranking por recurso, por plano, série, adoção e recorrência (recurringDays 2|3|5)',
      querystring: usageSummaryQuery,
      response: { 200: usageSummaryResponse },
    },
  }, async (request, reply) => {
    const out = await getFeatureUsageSummaryUseCase().execute({
      ...resolveUsageQuery(request.query, new Date()),
      recurringDays: request.query.recurringDays,
    });
    httpResponse.ok(reply, presentFeatureUsageSummary(out));
    return reply;
  });

  app.get<{ Params: { featureKey: string }; Querystring: UsageQuerystring }>('/features/:featureKey', {
    preHandler,
    schema: {
      tags,
      summary: 'Uso de um recurso no período: medidas, quebra por tipo e plano, série; chave fora do catálogo = 404',
      params: usageFeatureParams,
      querystring: usageQuery,
      response: { 200: usageFeatureDetailResponse },
    },
  }, async (request, reply) => {
    const out = await getFeatureUsageDetailUseCase().execute({
      ...resolveUsageQuery(request.query, new Date()),
      featureKey: request.params.featureKey,
    });
    httpResponse.ok(reply, presentFeatureUsageDetail(out));
    return reply;
  });

  app.get<{ Params: { featureKey: string }; Querystring: UsageQuerystring & { cursor?: string } }>('/features/:featureKey/tenants', {
    preHandler,
    schema: {
      tags,
      summary: 'Contas que mais usam o recurso (25 por página, cursor opaco); do tenant só id e nome; 1ª página auditada',
      params: usageFeatureParams,
      querystring: usageTenantsQuery,
      response: { 200: usageTenantsResponse },
    },
  }, async (request, reply) => {
    const out = await listFeatureUsageTenantsUseCase().execute({
      ...resolveUsageQuery(request.query, new Date()),
      featureKey: request.params.featureKey,
      cursor: request.query.cursor,
      actorUserId: request.user.userId,
    });
    httpResponse.ok(reply, presentFeatureUsageTenants(out));
    return reply;
  });
}
