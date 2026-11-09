import { prisma } from '../../../shared/database/prisma.client';
import { env } from '../../../shared/config/env';
import { PrismaJobLease } from '../../../shared/infrastructure/jobs/PrismaJobLease';
import { PrismaWorkerHeartbeatRepository } from '../../sessions/infrastructure/repositories/PrismaWorkerHeartbeatRepository';
import { OpsMetricsSamplerJob } from './jobs/OpsMetricsSamplerJob';
import { PrismaOpsMetricsSampleRepository } from './repositories/PrismaOpsMetricsSampleRepository';
import { PrismaDatabaseStatsSource } from './sources/PrismaDatabaseStatsSource';
import { RenderPlatformMetricsSource } from './sources/RenderPlatformMetricsSource';

/** IDs `srv-`/`dpg-` de `RENDER_RESOURCE_IDS` (vírgula). */
export function parseResourceIds(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Monta o sampler (MQ-22), parado. Sem `RENDER_API_KEY` ou sem IDs a fonte da Render fica de fora
 * (só Postgres e workers). Chamar só em `worker`/`all` com `OPS_METRICS_SAMPLER_ENABLED`.
 */
export function createOpsMetricsSamplerJob(): { job: OpsMetricsSamplerJob; platformEnabled: boolean } {
  const resourceIds = parseResourceIds(env.RENDER_RESOURCE_IDS);
  const platform = env.RENDER_API_KEY && resourceIds.length > 0
    ? new RenderPlatformMetricsSource({ apiKey: env.RENDER_API_KEY, resourceIds })
    : null;
  const job = new OpsMetricsSamplerJob({
    lease: new PrismaJobLease(prisma),
    samples: new PrismaOpsMetricsSampleRepository(prisma),
    heartbeats: new PrismaWorkerHeartbeatRepository(),
    platform,
    database: new PrismaDatabaseStatsSource(prisma),
    memoryLimitMb: env.OPS_MEMORY_LIMIT_MB ?? null,
  });
  return { job, platformEnabled: platform !== null };
}
