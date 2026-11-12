import { prisma } from '../../../shared/database/prisma.client';
import { env } from '../../../shared/config/env';
import { PrismaAuditLogRepository } from '../../../shared/audit/PrismaAuditLogRepository';
import { PrismaWorkerCapacityReader } from '../../sessions/infrastructure/repositories/PrismaWorkerCapacityReader';
import { workerScalingSettingsProvider } from '../../sessions/infrastructure/lease/sessionLeaseContainer';
import { GetInfraCostSettingsUseCase } from '../application/use-cases/GetInfraCostSettingsUseCase';
import { UpdateInfraCostSettingsUseCase } from '../application/use-cases/UpdateInfraCostSettingsUseCase';
import { GetInfraCostSummaryUseCase } from '../application/use-cases/GetInfraCostSummaryUseCase';
import { CloseInfraCostMonthUseCase } from '../application/use-cases/CloseInfraCostMonthUseCase';
import { ListInfraCostTenantsUseCase } from '../application/use-cases/ListInfraCostTenantsUseCase';
import { GetInfraCostHistoryUseCase } from '../application/use-cases/GetInfraCostHistoryUseCase';
import { PrismaInfraCostReportReader } from './repositories/PrismaInfraCostReportReader';
import { PrismaInfraCostSettingsRepository } from './repositories/PrismaInfraCostSettingsRepository';
import { PrismaInfraCostLiveReader } from './repositories/PrismaInfraCostLiveReader';
import { InfraCostCapacityReader } from './repositories/infraCostReadTimeout';
import { PrismaInfraCostSnapshotRepository } from './repositories/PrismaInfraCostSnapshotRepository';
import { PrismaInfraFxFetchStateRepository } from './repositories/PrismaInfraFxFetchStateRepository';
import { PrismaInfraTenantUsageReader } from './repositories/PrismaInfraTenantUsageReader';
import { PrismaInfraCostUsageReader } from './repositories/PrismaInfraCostUsageReader';
import { PrismaJobLease } from '../../../shared/infrastructure/jobs/PrismaJobLease';
import { InfraCostSnapshotJob } from './jobs/InfraCostSnapshotJob';
import { infraResourcePlanReader } from './sources/infraResourcePlanReader';
import { BcbPtaxFxRateSource } from './sources/BcbPtaxFxRateSource';
import { BcbSgsFxRateSource } from './sources/BcbSgsFxRateSource';

/** Composição dos custos da infraestrutura (super admin). Só tabelas locais; nunca chama a Render. */
let getSettings: GetInfraCostSettingsUseCase | undefined;
let updateSettings: UpdateInfraCostSettingsUseCase | undefined;
let getSummary: GetInfraCostSummaryUseCase | undefined;
let listTenants: ListInfraCostTenantsUseCase | undefined;
let getHistory: GetInfraCostHistoryUseCase | undefined;

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
    // Cotação gravada pelo job e estado da busca do dia (`last_known` quando falhou hoje).
    fxRates: new PrismaInfraCostSnapshotRepository(prisma),
    fxFetchState: new PrismaInfraFxFetchStateRepository(prisma),
    // Snapshots horários do mês (P2): soma por hora, projeção e rateio por sessão-hora.
    usage: new PrismaInfraCostUsageReader(prisma),
  }));
}

/** Lista por cliente (P3): conta do mês pelo resumo; fechado pelos valores congelados. */
export function listInfraCostTenantsUseCase(): ListInfraCostTenantsUseCase {
  return (listTenants ??= new ListInfraCostTenantsUseCase({
    summary: getInfraCostSummaryUseCase(),
    months: new PrismaInfraCostSnapshotRepository(prisma),
    reports: new PrismaInfraCostReportReader(prisma),
  }));
}

/** Histórico mensal (P3): só meses fechados. */
export function getInfraCostHistoryUseCase(): GetInfraCostHistoryUseCase {
  return (getHistory ??= new GetInfraCostHistoryUseCase(new PrismaInfraCostReportReader(prisma)));
}

/**
 * Job horário dos custos (COST-09/10), parado. Só em `worker`/`all` com `INFRA_COST_SNAPSHOT_ENABLED`; a
 * Render só com `RENDER_API_KEY` + `INFRA_COST_RENDER_RESOURCES` (senão as horas ficam sem leitura).
 */
export function createInfraCostSnapshotJob(): { job: InfraCostSnapshotJob; renderConfigured: boolean } {
  const plans = infraResourcePlanReader();
  const snapshots = new PrismaInfraCostSnapshotRepository(prisma);
  const settings = new PrismaInfraCostSettingsRepository(prisma);
  const job = new InfraCostSnapshotJob({
    lease: new PrismaJobLease(prisma),
    snapshots,
    plans,
    live: new PrismaInfraCostLiveReader(prisma, env.WORKER_SCALER_SERVICE_ID),
    tenants: new PrismaInfraTenantUsageReader(prisma),
    settings,
    fxSources: [new BcbPtaxFxRateSource(), new BcbSgsFxRateSource()],
    fxState: new PrismaInfraFxFetchStateRepository(prisma),
    // Fechamento mensal (COST-15): congela preços e cotação do mês anterior
    monthClose: new CloseInfraCostMonthUseCase({
      months: snapshots,
      fxRates: snapshots,
      settings,
      usage: new PrismaInfraCostUsageReader(prisma),
      scaling: workerScalingSettingsProvider(),
    }),
  });
  return { job, renderConfigured: plans.configuredKeys().length > 0 };
}
