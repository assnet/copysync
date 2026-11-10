import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { superAdminHook } from '../../../../shared/http/hooks/superAdminHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { prisma } from '../../../../shared/database/prisma.client';
import { ListOpsMetricsUseCase } from '../../application/use-cases/ListOpsMetricsUseCase';
import { PrismaOpsMetricsSampleRepository } from '../../infrastructure/repositories/PrismaOpsMetricsSampleRepository';
import { PrismaWorkerHeartbeatRepository } from '../../../sessions/infrastructure/repositories/PrismaWorkerHeartbeatRepository';
import { opsMetricsQuery, opsMetricsResponse } from '../schemas/opsMetrics.schema';
import { presentOpsMetrics } from '../presenters/opsMetricsPresenter';

const preHandler = [authHook, superAdminHook];
const tags = ['Ops metrics (admin)'];

let listOps: ListOpsMetricsUseCase | null = null;
const uc = () =>
  (listOps ??= new ListOpsMetricsUseCase(new PrismaOpsMetricsSampleRepository(prisma), new PrismaWorkerHeartbeatRepository()));

interface OpsMetricsQuery {
  metric?: string;
  from?: string;
  to?: string;
  cursor?: string;
}

/**
 * Super admin: amostras de recursos e estado dos workers (MQ-25). Registrado em `/api/admin/ops/metrics`.
 * Lê só `ops_metrics_samples`/`worker_heartbeats`; nunca chama a Render (docs/ops-metricas.md).
 */
export async function opsMetricsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: OpsMetricsQuery }>('/', {
    preHandler,
    schema: {
      tags,
      summary: 'Amostras agregadas de CPU/RAM/Postgres (5 min, 7 dias) e workers vivos; paginado por cursor',
      querystring: opsMetricsQuery,
      response: { 200: opsMetricsResponse },
    },
  }, async (request, reply) => {
    const { metric, from, to, cursor } = request.query;
    const out = await uc().execute({
      metric,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      cursor,
    });
    httpResponse.ok(reply, presentOpsMetrics(out));
  });
}
