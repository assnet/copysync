import { prisma } from '../../../shared/database/prisma.client';
import { PrismaAuditLogRepository } from '../../../shared/audit/PrismaAuditLogRepository';
import { GetFeatureUsageSummaryUseCase, type FeatureUsageDeps } from '../application/use-cases/GetFeatureUsageSummaryUseCase';
import { GetFeatureUsageDetailUseCase } from '../application/use-cases/GetFeatureUsageDetailUseCase';
import { ListFeatureUsageTenantsUseCase } from '../application/use-cases/ListFeatureUsageTenantsUseCase';
import { PrismaLiveFeatureUsageReader } from './repositories/PrismaLiveFeatureUsageReader';
import { PrismaUsageTenantDirectory } from './repositories/PrismaUsageTenantDirectory';
import { usageReadGate } from './repositories/featureUsageReadTimeout';

/**
 * Composição do uso dos recursos (super admin). P1: leitura sob demanda das tabelas de domínio, uma leitura
 * de uso por processo (`usageReadGate`, compartilhado pelas três rotas) com orçamento de 2 s por pedido.
 */
let deps: FeatureUsageDeps | undefined;
let getSummary: GetFeatureUsageSummaryUseCase | undefined;
let getDetail: GetFeatureUsageDetailUseCase | undefined;
let listTenants: ListFeatureUsageTenantsUseCase | undefined;

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
