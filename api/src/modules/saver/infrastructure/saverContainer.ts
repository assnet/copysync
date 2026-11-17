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
import { PrismaAuditLogRepository } from '../../../shared/audit/PrismaAuditLogRepository';
import {
  ExportPlatformSaverContactsUseCase,
  GetPlatformSaverContactUseCase,
  ListPlatformSaverContactsUseCase,
} from '../application/use-cases/PlatformSaverContactsUseCases';
import { ExportSavedContactsUseCase } from '../application/use-cases/ExportSavedContactsUseCase';
import {
  GetSaverConfigUseCase,
  ListSaverExportGrantsUseCase,
  SetSaverExportGrantUseCase,
  UpdateSaverConfigUseCase,
} from '../application/use-cases/SaverConfigUseCases';
import { PrismaEntitlementReader } from '../../tenants/infrastructure/repositories/PrismaEntitlementReader';

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
};

// ── Base da plataforma (T16, só super admin) ──
const audit = lazy(() => new PrismaAuditLogRepository());
const listPlatformContacts   = lazy(() => new ListPlatformSaverContactsUseCase(platformContacts(), audit()));
const getPlatformContact     = lazy(() => new GetPlatformSaverContactUseCase(platformContacts(), audit()));
const exportPlatformContacts = lazy(() => new ExportPlatformSaverContactsUseCase(platformContacts(), audit()));

export const saverPlatformUseCases = {
  get listContacts(): ListPlatformSaverContactsUseCase { return listPlatformContacts(); },
  get getContact(): GetPlatformSaverContactUseCase { return getPlatformContact(); },
  get exportContacts(): ExportPlatformSaverContactsUseCase { return exportPlatformContacts(); },
};

// ── Exportação e configuração do tenant (T17, T18) ──
const entitlements        = lazy(() => new PrismaEntitlementReader(prisma));
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
