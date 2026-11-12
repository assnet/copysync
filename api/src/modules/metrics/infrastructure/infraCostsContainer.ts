import { prisma } from '../../../shared/database/prisma.client';
import { env } from '../../../shared/config/env';
import { PrismaAuditLogRepository } from '../../../shared/audit/PrismaAuditLogRepository';
import { PrismaWorkerCapacityReader } from '../../sessions/infrastructure/repositories/PrismaWorkerCapacityReader';
import { workerScalingSettingsProvider } from '../../sessions/infrastructure/lease/sessionLeaseContainer';
import { GetInfraCostSettingsUseCase } from '../application/use-cases/GetInfraCostSettingsUseCase';
import { UpdateInfraCostSettingsUseCase } from '../application/use-cases/UpdateInfraCostSettingsUseCase';
import { GetInfraCostSummaryUseCase } from '../application/use-cases/GetInfraCostSummaryUseCase';
import { PrismaInfraCostSettingsRepository } from './repositories/PrismaInfraCostSettingsRepository';
import { PrismaInfraCostLiveReader } from './repositories/PrismaInfraCostLiveReader';
import { InfraCostCapacityReader } from './repositories/infraCostReadTimeout';

/** Composição dos custos da infraestrutura (super admin). Só tabelas locais; nunca chama a Render. */
let getSettings: GetInfraCostSettingsUseCase | undefined;
let updateSettings: UpdateInfraCostSettingsUseCase | undefined;
let getSummary: GetInfraCostSummaryUseCase | undefined;

export function getInfraCostSettingsUseCase(): GetInfraCostSettingsUseCase {
  return (getSettings ??= new GetInfraCostSettingsUseCase(new PrismaInfraCostSettingsRepository(prisma)));
}

export function updateInfraCostSettingsUseCase(): UpdateInfraCostSettingsUseCase {
  return (updateSettings ??= new UpdateInfraCostSettingsUseCase(
    new PrismaInfraCostSettingsRepository(prisma),
    new PrismaAuditLogRepository(),
  ));
}

export function getInfraCostSummaryUseCase(): GetInfraCostSummaryUseCase {
  return (getSummary ??= new GetInfraCostSummaryUseCase({
    settings: new PrismaInfraCostSettingsRepository(prisma),
    // Lido também no processo http, como as métricas (`opsMetrics`): só filtra as amostras no SQL
    // (instâncias do worker); nunca sai na resposta nem no log.
    live: new PrismaInfraCostLiveReader(prisma, env.WORKER_SCALER_SERVICE_ID),
    // Timeout → 503 só aqui; os outros consumidores do leitor seguem iguais.
    capacity: new InfraCostCapacityReader(new PrismaWorkerCapacityReader(prisma)),
    // Singleton do processo: o use case lê `.current().value` a cada chamada.
    scaling: workerScalingSettingsProvider(),
  }));
}
