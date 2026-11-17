import { prisma } from '../../../shared/database/prisma.client';
import { currentWorkerId } from '../../../shared/config/workerIdentity';
import { PrismaSaverGroupRepository } from './repositories/PrismaSaverGroupRepository';
import { PrismaSaverMembershipRepository } from './repositories/PrismaSaverMembershipRepository';
import { PrismaPlatformSaverContactRepository } from './repositories/PrismaPlatformSaverContactRepository';
import { PrismaSaverExportGrantRepository } from './repositories/PrismaSaverExportGrantRepository';
import { PrismaSaverTeamReader } from './repositories/PrismaSaverTeamReader';
import { PrismaSaverExtractionQueue } from './repositories/PrismaSaverExtractionQueue';
import { PrismaSaverSessionStateStore } from './repositories/PrismaSaverSessionStateStore';
import { PrismaSaverConfigRepository } from './repositories/PrismaSaverConfigRepository';
import type { ISaverGroupRepository } from '../domain/contracts/ISaverGroupRepository';
import type { ISaverMembershipRepository } from '../domain/contracts/ISaverMembershipRepository';
import type { IPlatformSaverContactRepository } from '../domain/contracts/IPlatformSaverContactRepository';
import type { ISaverExportGrantRepository } from '../domain/contracts/ISaverExportGrantRepository';
import type { ISaverTeamReader } from '../domain/contracts/ISaverTeamReader';
import type { ISaverExtractionQueue } from '../domain/contracts/ISaverExtractionQueue';
import type { ISaverSessionStateStore } from '../domain/contracts/ISaverSessionStateStore';
import type { ISaverConfigRepository } from '../domain/contracts/ISaverConfigRepository';
import { env } from '../../../shared/config/env';
import { featureAudienceReader } from '../../tenants/infrastructure/featureAudience';
import type { IFeatureAudienceReader } from '../../tenants/domain/contracts/IFeatureAudienceRepository';
import { PrismaEntitlementReader } from '../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import { GetSaverOverviewUseCase } from '../application/use-cases/GetSaverOverviewUseCase';
import { ListSaverSessionGroupsUseCase } from '../application/use-cases/ListSaverSessionGroupsUseCase';
import { PrismaSaverSessionReader } from './repositories/PrismaSaverSessionReader';
import { RequestSaverExtractionUseCase } from '../application/use-cases/RequestSaverExtractionUseCase';
import { GetSaverExtractionUseCase } from '../application/use-cases/GetSaverExtractionUseCase';
import { CancelSaverExtractionUseCase } from '../application/use-cases/CancelSaverExtractionUseCase';
import { RemoveSaverGroupUseCase } from '../application/use-cases/RemoveSaverGroupUseCase';
import { ListSaverGroupsUseCase } from '../application/use-cases/ListSaverGroupsUseCase';
import { getActiveEngine } from '../../../shared/engine/activeEngine';
import { EngineNotReadyError } from '../../../shared/errors/internal/MessagingErrors';
import { PrismaAuditLogRepository } from '../../../shared/audit/PrismaAuditLogRepository';
import {
  ExportPlatformSaverContactsUseCase,
  GetPlatformSaverContactUseCase,
  ListPlatformSaverContactsUseCase,
  ListPlatformSaverTenantsUseCase,
} from '../application/use-cases/PlatformSaverContactsUseCases';
import { ExportSavedContactsUseCase } from '../application/use-cases/ExportSavedContactsUseCase';
import {
  GetSaverConfigUseCase,
  ListSaverExportGrantsUseCase,
  SetSaverExportGrantUseCase,
  UpdateSaverConfigUseCase,
} from '../application/use-cases/SaverConfigUseCases';

/*
 * Composição do Saver (molde `linkRotationContainer.ts`). Tudo lazy: importar não toca banco.
 * Fila e estado por sessão levam o `workerId` do processo: claim só de sessão com lease vivo deste processo.
 * `platformContacts` lê a base sem tenant: só use cases `Platform*` (super admin) e a gravação da extração.
 * Use cases e rotas entram nas tasks seguintes (T9–T19).
 */
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

const groups           = lazy(() => new PrismaSaverGroupRepository(prisma));
const memberships      = lazy(() => new PrismaSaverMembershipRepository(prisma));
const platformContacts = lazy(() => new PrismaPlatformSaverContactRepository(prisma));
const exportGrants     = lazy(() => new PrismaSaverExportGrantRepository(prisma));
const team             = lazy(() => new PrismaSaverTeamReader(prisma));
const queue            = lazy(() => new PrismaSaverExtractionQueue(prisma, currentWorkerId()));
const sessionStates    = lazy(() => new PrismaSaverSessionStateStore(prisma, currentWorkerId()));
const configs          = lazy(() => new PrismaSaverConfigRepository(prisma));

export const saverContainer = {
  get groups(): ISaverGroupRepository { return groups(); },
  get memberships(): ISaverMembershipRepository { return memberships(); },
  get platformContacts(): IPlatformSaverContactRepository { return platformContacts(); },
  get exportGrants(): ISaverExportGrantRepository { return exportGrants(); },
  get team(): ISaverTeamReader { return team(); },
  get queue(): ISaverExtractionQueue { return queue(); },
  get sessionStates(): ISaverSessionStateStore { return sessionStates(); },
  get configs(): ISaverConfigRepository { return configs(); },

  get getOverview(): GetSaverOverviewUseCase { return getOverview(); },
  get listSessionGroups(): ListSaverSessionGroupsUseCase { return listSessionGroups(); },
  get requestExtraction(): RequestSaverExtractionUseCase { return requestExtraction(); },
  get getExtraction(): GetSaverExtractionUseCase { return getExtraction(); },
  get cancelExtraction(): CancelSaverExtractionUseCase { return cancelExtraction(); },
  get removeGroup(): RemoveSaverGroupUseCase { return removeGroup(); },
  get listGroups(): ListSaverGroupsUseCase { return listGroups(); },
};

/*
 * Use cases do tenant (T10–T12). Ficam no fim do arquivo para não conflitar com outras tasks.
 * `queueRunning` = `SAVER_EXTRACTION_WORKER_ENABLED` (ligar no `http` e no `worker`: o job só sobe no `worker`).
 */
const entitlements = lazy(() => new PrismaEntitlementReader(prisma));
const saverQueueRunning = (): boolean =>
  env.SAVER_EXTRACTION_WORKER_ENABLED;

const getOverview = lazy(() => new GetSaverOverviewUseCase({
    entitlements: entitlements(),
    groups: groups(),
    memberships: memberships(),
    queue: queue(),
    configs: configs(),
    exportGrants: exportGrants(),
    queueRunning: saverQueueRunning,
}));

const sessionReader = lazy(() => new PrismaSaverSessionReader(prisma));
/** Engine ativa do processo (remota em `http`); sem engine = `ENGINE_NOT_READY`. */
function activeEngine() {
  const engine = getActiveEngine();
  if (!engine) throw new EngineNotReadyError();
  return engine;
}

const listSessionGroups = lazy(() => new ListSaverSessionGroupsUseCase({
  sessions: sessionReader(),
  groups: groups(),
  engine: activeEngine,
}));

const requestExtraction = lazy(() => new RequestSaverExtractionUseCase({
  sessions: sessionReader(),
  entitlements: entitlements(),
  queue: queue(),
  engine: activeEngine,
}));
const getExtraction    = lazy(() => new GetSaverExtractionUseCase({ queue: queue() }));
const cancelExtraction = lazy(() => new CancelSaverExtractionUseCase({ queue: queue() }));
const removeGroup      = lazy(() => new RemoveSaverGroupUseCase({ groups: groups(), queue: queue() }));
const listGroups       = lazy(() => new ListSaverGroupsUseCase({ groups: groups() }));

// ── Base da plataforma (T16, só super admin) ──
const audit = lazy(() => new PrismaAuditLogRepository());
const listPlatformContacts   = lazy(() => new ListPlatformSaverContactsUseCase(platformContacts(), audit()));
const getPlatformContact     = lazy(() => new GetPlatformSaverContactUseCase(platformContacts(), audit()));
const listPlatformTenants    = lazy(() => new ListPlatformSaverTenantsUseCase(platformContacts()));
const exportPlatformContacts = lazy(() => new ExportPlatformSaverContactsUseCase(platformContacts(), audit()));

export const saverPlatformUseCases = {
  get listContacts(): ListPlatformSaverContactsUseCase { return listPlatformContacts(); },
  get getContact(): GetPlatformSaverContactUseCase { return getPlatformContact(); },
  get exportContacts(): ExportPlatformSaverContactsUseCase { return exportPlatformContacts(); },
  get listTenants(): ListPlatformSaverTenantsUseCase { return listPlatformTenants(); },
};

// ── Exportação e configuração do tenant (T17, T18) ──
const exportSavedContacts = lazy(() => new ExportSavedContactsUseCase(groups(), memberships(), exportGrants(), audit()));
const getConfig           = lazy(() => new GetSaverConfigUseCase(configs(), entitlements()));
const updateConfig        = lazy(() => new UpdateSaverConfigUseCase(configs(), entitlements()));
const listExportGrants    = lazy(() => new ListSaverExportGrantsUseCase(team(), exportGrants()));
const setExportGrant      = lazy(() => new SetSaverExportGrantUseCase(team(), exportGrants(), audit()));

export const saverTenantUseCases = {
  get exportSavedContacts(): ExportSavedContactsUseCase { return exportSavedContacts(); },
  get getConfig(): GetSaverConfigUseCase { return getConfig(); },
  get updateConfig(): UpdateSaverConfigUseCase { return updateConfig(); },
  get listExportGrants(): ListSaverExportGrantsUseCase { return listExportGrants(); },
  get setExportGrant(): SetSaverExportGrantUseCase { return setExportGrant(); },
};

// ── Audiência do produto (SAVER-47): flag "Só super admin" de `/admin/plan-entitlements`, lida a cada pedido ──
export const saverAudience = {
  reader: (): IFeatureAudienceReader => featureAudienceReader(),
};
