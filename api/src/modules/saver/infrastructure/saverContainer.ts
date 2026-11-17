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
import { PrismaEntitlementReader } from '../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import { GetSaverOverviewUseCase } from '../application/use-cases/GetSaverOverviewUseCase';

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
};

/*
 * Use cases do tenant (T10–T12). Ficam no fim do arquivo para não conflitar com outras tasks.
 * `SAVER_EXTRACTION_WORKER_ENABLED` nasce no T14: lida por chave até lá (ausente = fila parada).
 */
const entitlements = lazy(() => new PrismaEntitlementReader(prisma));
const saverQueueRunning = (): boolean =>
  (env as unknown as Record<string, unknown>)['SAVER_EXTRACTION_WORKER_ENABLED'] === true;

const getOverview = lazy(() => new GetSaverOverviewUseCase({
    entitlements: entitlements(),
    groups: groups(),
    memberships: memberships(),
    queue: queue(),
    configs: configs(),
    exportGrants: exportGrants(),
    queueRunning: saverQueueRunning,
}));
