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
    // O id do serviço worker só separa as amostras; nunca sai na resposta.
    live: new PrismaInfraCostLiveReader(prisma, env.WORKER_SCALER_SERVICE_ID),
    capacity: new PrismaWorkerCapacityReader(prisma),
    // Singleton do processo: o use case lê `.current().value` a cada chamada.
    scaling: workerScalingSettingsProvider(),
  }));
}
