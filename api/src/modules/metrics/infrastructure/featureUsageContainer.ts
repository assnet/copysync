import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma.client';
import { PrismaJobLease } from '../../../shared/infrastructure/jobs/PrismaJobLease';
import { PrismaAuditLogRepository } from '../../../shared/audit/PrismaAuditLogRepository';
import { GetFeatureUsageSummaryUseCase, type FeatureUsageDeps } from '../application/use-cases/GetFeatureUsageSummaryUseCase';
import { GetFeatureUsageDetailUseCase } from '../application/use-cases/GetFeatureUsageDetailUseCase';
import { GetFeatureUsageScreensUseCase } from '../application/use-cases/GetFeatureUsageScreensUseCase';
import { RecordPageViewUseCase } from '../application/use-cases/RecordPageViewUseCase';
import { ListFeatureUsageTenantsUseCase } from '../application/use-cases/ListFeatureUsageTenantsUseCase';
import { RollupFeatureUsageUseCase } from '../application/use-cases/RollupFeatureUsageUseCase';
import { RecordFeatureUsageUseCase } from '../application/use-cases/RecordFeatureUsageUseCase';
import type { IFeatureUsageRecorder } from '../domain/contracts/IFeatureUsageRecorder';
import { FEATURE_USAGE_ROLLUP_READ_BUDGET_MS, FeatureUsageRollupJob } from './jobs/FeatureUsageRollupJob';
import { PrismaDailyFeatureUsageReader } from './repositories/PrismaDailyFeatureUsageReader';
import { PrismaFeatureUsageDailyRepository } from './repositories/PrismaFeatureUsageDailyRepository';
import { PrismaFeatureUsageRollupStateRepository } from './repositories/PrismaFeatureUsageRollupStateRepository';
import { FEATURE_USAGE_SOURCES, PrismaLiveFeatureUsageReader } from './repositories/PrismaLiveFeatureUsageReader';
import { PrismaFeatureEligibilityReader } from './repositories/PrismaFeatureEligibilityReader';
import { featureAudienceDefaults } from '../../tenants/infrastructure/featureAudience';
import { PrismaPageViewReader } from './repositories/PrismaPageViewReader';
import { PrismaUsageTenantDirectory } from './repositories/PrismaUsageTenantDirectory';
import { createReadBudget, usageReadGate } from './repositories/featureUsageReadTimeout';

/**
 * Composição do uso dos recursos (super admin). Uma leitura de uso por processo (`usageReadGate`, compartilhado
 * pelas três rotas) com orçamento de 2 s por pedido. Fonte por pedido: agregado diário quando o marco do backfill
 * cobre o período, senão sob demanda; recurso só do contador sempre do agregado.
 */
let deps: FeatureUsageDeps | undefined;
let getSummary: GetFeatureUsageSummaryUseCase | undefined;
let getDetail: GetFeatureUsageDetailUseCase | undefined;
let listTenants: ListFeatureUsageTenantsUseCase | undefined;
let recorder: IFeatureUsageRecorder | undefined;
let getScreens: GetFeatureUsageScreensUseCase | undefined;
let recordPageView: RecordPageViewUseCase | undefined;

function featureUsageDeps(): FeatureUsageDeps {
  return (deps ??= {
    reader: new PrismaLiveFeatureUsageReader(prisma),
    dailyReader: new PrismaDailyFeatureUsageReader(prisma),
    rollupState: new PrismaFeatureUsageRollupStateRepository(prisma),
    directory: new PrismaUsageTenantDirectory(prisma),
    eligibility: new PrismaFeatureEligibilityReader(prisma, featureAudienceDefaults),
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

/** Contador de uso (Story, chat): grava em `feature_usage_daily` desde a primeira escrita (ou do corte gravado, recurso `CUTOVER`). */
export function featureUsageRecorder(): IFeatureUsageRecorder {
  return (recorder ??= new RecordFeatureUsageUseCase({
    daily: new PrismaFeatureUsageDailyRepository(prisma),
    cutovers: new PrismaFeatureUsageRollupStateRepository(prisma),
  }));
}

/** Aba Telas (P3): consulta própria agregada no SQL, no mesmo portão e orçamento das leituras de uso. */
export function getFeatureUsageScreensUseCase(): GetFeatureUsageScreensUseCase {
  const d = featureUsageDeps();
  return (getScreens ??= new GetFeatureUsageScreensUseCase({ pageViews: new PrismaPageViewReader(prisma), directory: d.directory, gate: d.gate }));
}

/** Visita de tela (P3): `markOnce` pelo contador de uso (fail-open). */
export function recordPageViewUseCase(): RecordPageViewUseCase {
  return (recordPageView ??= new RecordPageViewUseCase({ recorder: featureUsageRecorder() }));
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
