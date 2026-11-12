import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { superAdminHook } from '../../../../shared/http/hooks/superAdminHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { prisma } from '../../../../shared/database/prisma.client';
import { env } from '../../../../shared/config/env';
import { opsWorkerServiceId } from '../../domain/services/opsMetricsSeriesPolicy';
import { ListOpsMetricsUseCase } from '../../application/use-cases/ListOpsMetricsUseCase';
import { PrismaOpsMetricsSampleRepository } from '../../infrastructure/repositories/PrismaOpsMetricsSampleRepository';
import { PrismaWorkerHeartbeatRepository } from '../../../sessions/infrastructure/repositories/PrismaWorkerHeartbeatRepository';
import { GetOpsMetricsSeriesUseCase } from '../../application/use-cases/GetOpsMetricsSeriesUseCase';
import { GetOpsMetricsLatestUseCase } from '../../application/use-cases/GetOpsMetricsLatestUseCase';
import {
  opsMetricsLatestResponse,
  opsMetricsQuery,
  opsMetricsResponse,
  opsMetricsSeriesQuery,
  opsMetricsSeriesResponse,
} from '../schemas/opsMetrics.schema';
import { presentOpsMetrics, presentOpsMetricsLatest, presentOpsMetricsSeries } from '../presenters/opsMetricsPresenter';

const preHandler = [authHook, superAdminHook];
const tags = ['Ops metrics (admin)'];

let listOps: ListOpsMetricsUseCase | null = null;
const uc = () =>
  (listOps ??= new ListOpsMetricsUseCase(new PrismaOpsMetricsSampleRepository(prisma), new PrismaWorkerHeartbeatRepository()));

/** Amostras da Render do serviço worker viram `worker_service`; sem a env (ou inválida), tudo `srv-` é API. */
const workerServiceId = () => opsWorkerServiceId(env.WORKER_SCALER_SERVICE_ID);
let seriesUc: GetOpsMetricsSeriesUseCase | null = null;
const series = () =>
  (seriesUc ??= new GetOpsMetricsSeriesUseCase(new PrismaOpsMetricsSampleRepository(prisma), undefined, workerServiceId()));
let latestUc: GetOpsMetricsLatestUseCase | null = null;
const latest = () =>
  (latestUc ??= new GetOpsMetricsLatestUseCase(
    new PrismaOpsMetricsSampleRepository(prisma), new PrismaWorkerHeartbeatRepository(), undefined, workerServiceId(),
  ));

interface OpsMetricsSeriesQuery {
  metrics?: string;
  from?: string;
  to?: string;
  resource?: string;
}

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

  app.get<{ Querystring: OpsMetricsSeriesQuery }>('/series', {
    preHandler,
    schema: {
      tags,
      summary: 'Séries agregadas em baldes no servidor (avg/min/max) para o dashboard de consumo',
      querystring: opsMetricsSeriesQuery,
      response: { 200: opsMetricsSeriesResponse },
    },
  }, async (request, reply) => {
    const { metrics, from, to, resource } = request.query;
    const out = await series().execute({
      metrics: metrics?.split(','),
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      resource,
    });
    httpResponse.ok(reply, presentOpsMetricsSeries(out));
  });

  app.get('/latest', {
    preHandler,
    schema: {
      tags,
      summary: 'Último valor por recurso/métrica (15 min), limiares dos alertas, top consultas e workers vivos',
      response: { 200: opsMetricsLatestResponse },
    },
  }, async (_request, reply) => {
    httpResponse.ok(reply, presentOpsMetricsLatest(await latest().execute()));
  });
}
