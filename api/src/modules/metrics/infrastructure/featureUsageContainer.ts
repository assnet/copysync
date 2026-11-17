import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma.client';
import { PrismaJobLease } from '../../../shared/infrastructure/jobs/PrismaJobLease';
import { PrismaAuditLogRepository } from '../../../shared/audit/PrismaAuditLogRepository';
import { GetFeatureUsageSummaryUseCase, type FeatureUsageDeps } from '../application/use-cases/GetFeatureUsageSummaryUseCase';
import { GetFeatureUsageDetailUseCase } from '../application/use-cases/GetFeatureUsageDetailUseCase';
import { ListFeatureUsageTenantsUseCase } from '../application/use-cases/ListFeatureUsageTenantsUseCase';
import { RollupFeatureUsageUseCase } from '../application/use-cases/RollupFeatureUsageUseCase';
import { RecordFeatureUsageUseCase } from '../application/use-cases/RecordFeatureUsageUseCase';
import type { IFeatureUsageRecorder } from '../domain/contracts/IFeatureUsageRecorder';
import { FEATURE_USAGE_ROLLUP_READ_BUDGET_MS, FeatureUsageRollupJob } from './jobs/FeatureUsageRollupJob';
import { PrismaFeatureUsageDailyRepository } from './repositories/PrismaFeatureUsageDailyRepository';
import { PrismaFeatureUsageRollupStateRepository } from './repositories/PrismaFeatureUsageRollupStateRepository';
import { FEATURE_USAGE_SOURCES, PrismaLiveFeatureUsageReader } from './repositories/PrismaLiveFeatureUsageReader';
import { PrismaUsageTenantDirectory } from './repositories/PrismaUsageTenantDirectory';
import { createReadBudget, usageReadGate } from './repositories/featureUsageReadTimeout';

/**
 * Composição do uso dos recursos (super admin). P1: leitura sob demanda das tabelas de domínio, uma leitura
 * de uso por processo (`usageReadGate`, compartilhado pelas três rotas) com orçamento de 2 s por pedido.
 */
let deps: FeatureUsageDeps | undefined;
let getSummary: GetFeatureUsageSummaryUseCase | undefined;
let getDetail: GetFeatureUsageDetailUseCase | undefined;
let listTenants: ListFeatureUsageTenantsUseCase | undefined;
let recorder: IFeatureUsageRecorder | undefined;

function featureUsageDeps(): FeatureUsageDeps {
  return (deps ??= {
    reader: new PrismaLiveFeatureUsageReader(prisma),
    directory: new PrismaUsageTenantDirectory(prisma),
    gate: usageReadGate,
  });
}

export function getFeatureUsageSummaryUseCase(): GetFeatureUsageSummaryUseCase {
  return (getSummary ??= new GetFeatureUsageSummaryUseCase(featureUsageDeps()));
}

export function getFeatureUsageDetailUseCase(): GetFeatureUsageDetailUseCase {
  return (getDetail ??= new GetFeatureUsageDetailUseCase(featureUsageDeps()));
}

export function listFeatureUsageTenantsUseCase(): ListFeatureUsageTenantsUseCase {
  return (listTenants ??= new ListFeatureUsageTenantsUseCase({ ...featureUsageDeps(), audit: new PrismaAuditLogRepository() }));
}

/** Contador de uso (Story, chat): grava em `feature_usage_daily` a partir da data de corte de cada recurso. */
export function featureUsageRecorder(): IFeatureUsageRecorder {
  return (recorder ??= new RecordFeatureUsageUseCase({ daily: new PrismaFeatureUsageDailyRepository(prisma) }));
}

/**
 * Job de consolidação (P2): leitor sob demanda com uma leitura por fonte (`FEATURE_USAGE_SOURCES`), agregado,
 * marco em `platform_settings` e lease em `job_leases`. Só montado no `worker`/`all` com a flag.
 */
export function createFeatureUsageRollupJob(): FeatureUsageRollupJob {
  const rollup = new RollupFeatureUsageUseCase({
    reader: new PrismaLiveFeatureUsageReader(prisma),
    daily: new PrismaFeatureUsageDailyRepository(prisma),
    state: new PrismaFeatureUsageRollupStateRepository(prisma),
    lease: new PrismaJobLease(prisma),
    newBudget: () => createReadBudget(FEATURE_USAGE_ROLLUP_READ_BUDGET_MS),
    sourceGroups: FEATURE_USAGE_SOURCES.map((s) => s.keys),
    ownerId: randomUUID(),
  });
  return new FeatureUsageRollupJob({ rollup });
}
