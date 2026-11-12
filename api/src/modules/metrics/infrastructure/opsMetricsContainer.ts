import { prisma } from '../../../shared/database/prisma.client';
import { env } from '../../../shared/config/env';
import { PrismaJobLease } from '../../../shared/infrastructure/jobs/PrismaJobLease';
import { workerAdoptionConfig } from '../../../shared/config/workerAdoption';
import { PrismaWorkerHeartbeatRepository } from '../../sessions/infrastructure/repositories/PrismaWorkerHeartbeatRepository';
import { PrismaSessionAdoptionRepository } from '../../sessions/infrastructure/repositories/PrismaSessionAdoptionRepository';
import { workerScalingSettingsProvider } from '../../sessions/infrastructure/lease/sessionLeaseContainer';
import { OpsMetricsSamplerJob } from './jobs/OpsMetricsSamplerJob';
import { PrismaOpsMetricsSampleRepository } from './repositories/PrismaOpsMetricsSampleRepository';
import { PrismaDatabaseStatsSource } from './sources/PrismaDatabaseStatsSource';
import { RenderPlatformMetricsSource } from './sources/RenderPlatformMetricsSource';
import { SessionsOccupancySource } from './sources/SessionsOccupancySource';
import { samplerResourceIds } from './samplerResourceIds';


/**
 * Monta o sampler (MQ-22), parado. Sem `RENDER_API_KEY` ou sem IDs (lista + serviço worker) a fonte da Render fica de fora
 * (só Postgres, workers e sessões). A fonte de sessões (WSCALE-08) lê adoção e teto a cada tick; o alerta de ocupação (WSCALE-17) lê adoção e `alertOccupancyRatio` a cada tick. Chamar só em `worker`/`all` com `OPS_METRICS_SAMPLER_ENABLED`.
 */
export function createOpsMetricsSamplerJob(): { job: OpsMetricsSamplerJob; platformEnabled: boolean } {
  // O serviço worker (`WORKER_SCALER_SERVICE_ID`) entra sozinho: réplicas sem mexer em `RENDER_RESOURCE_IDS`.
  const resourceIds = samplerResourceIds(env.RENDER_RESOURCE_IDS, env.WORKER_SCALER_SERVICE_ID);
  const platform = env.RENDER_API_KEY && resourceIds.length > 0
    ? new RenderPlatformMetricsSource({ apiKey: env.RENDER_API_KEY, resourceIds })
    : null;
  const heartbeats = new PrismaWorkerHeartbeatRepository();
  const settings = workerScalingSettingsProvider();
  const adoptionEnabled = () => workerAdoptionConfig().enabled;
  const job = new OpsMetricsSamplerJob({
    lease: new PrismaJobLease(prisma),
    samples: new PrismaOpsMetricsSampleRepository(prisma),
    heartbeats,
    platform,
    database: new PrismaDatabaseStatsSource(prisma),
    sessions: new SessionsOccupancySource({
      prisma,
      adoptionEnabled,
      adoption: new PrismaSessionAdoptionRepository(),
      heartbeats,
      maxSessionsPerWorker: () => settings.current().value.maxSessionsPerWorker,
    }),
    memoryLimitMb: env.OPS_MEMORY_LIMIT_MB ?? null,
    // Sem adoção o alerta de ocupação sai daqui (WSCALE-17); com ela, do WorkerCapacityAlertJob
    adoptionEnabled,
    occupancyAlertRatio: () => settings.current().value.alertOccupancyRatio,
  });
  return { job, platformEnabled: platform !== null };
}
