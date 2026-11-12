import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { superAdminHook } from '../../../../shared/http/hooks/superAdminHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import {
  getInfraCostSettingsUseCase,
  getInfraCostSummaryUseCase,
  updateInfraCostSettingsUseCase,
} from '../../infrastructure/infraCostsContainer';
import {
  infraCostSettingsBody,
  infraCostSettingsResponse,
  infraCostSummaryQuery,
  infraCostSummaryResponse,
} from '../schemas/infraCosts.schema';
import { presentInfraCostSummary } from '../presenters/infraCostsPresenter';

const preHandler = [authHook, superAdminHook];
const tags = ['Infra costs (admin)'];

/**
 * Super admin: custos da infraestrutura (`.specs/features/infra-costs`). Registrado em `/api/admin/costs`.
 * Lê só tabelas locais (configuração, amostras, capacidade); nunca chama a Render.
 */
export async function infraCostsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settings', {
    preHandler,
    schema: { tags, summary: 'Preços da infraestrutura (USD), workspace e cotação; origem e updatedAt', response: { 200: infraCostSettingsResponse } },
  }, async (_request, reply) => {
    httpResponse.ok(reply, await getInfraCostSettingsUseCase().execute());
  });

  app.put<{ Body: { settings: unknown; expectedUpdatedAt: string | null } }>('/settings', {
    preHandler,
    schema: {
      tags,
      summary: 'Grava a configuração de custos (documento inteiro, com controle de concorrência), auditado',
      body: infraCostSettingsBody,
      response: { 200: infraCostSettingsResponse },
    },
  }, async (request, reply) => {
    const data = await updateInfraCostSettingsUseCase().execute({
      settings: request.body.settings,
      expectedUpdatedAt: request.body.expectedUpdatedAt,
      actorUserId: request.user.userId,
    });
    httpResponse.ok(reply, data);
  });

  app.get<{ Querystring: { month?: string } }>('/summary', {
    preHandler,
    schema: {
      tags,
      summary: 'Custo do mês (YYYY-MM, padrão o corrente): soma por hora com projeção, rateio por sessão e por plano; mês sem dado = 400',
      querystring: infraCostSummaryQuery,
      response: { 200: infraCostSummaryResponse },
    },
  }, async (request, reply) => {
    const out = await getInfraCostSummaryUseCase().execute({ month: request.query.month });
    httpResponse.ok(reply, presentInfraCostSummary(out));
  });
}
