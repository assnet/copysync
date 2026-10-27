import { prisma } from '../../../shared/database/prisma.client';
import { offersContainer } from '../../campaigns/infrastructure/offersContainer';
import { PrismaGroupMonitorRepository } from './repositories/PrismaGroupMonitorRepository';
import { PrismaCapturedOfferRepository } from './repositories/PrismaCapturedOfferRepository';
import { CampaignsOfferQueue, CampaignsTenantLinkBuilder, ChatMonitorGroupDirectory } from './adapters/CampaignsMonitorAdapters';
import {
  GetGroupMonitorConfigUseCase, SaveBroadcastGroupsUseCase, SaveGroupMonitorSettingsUseCase, SaveMonitoredGroupsUseCase,
} from '../application/use-cases/GroupMonitorConfigUseCases';
import { RegisterCapturedMessageUseCase } from '../application/use-cases/RegisterCapturedMessageUseCase';
import { ProcessPendingCapturedOffersUseCase } from '../application/use-cases/ProcessPendingCapturedOffersUseCase';
import { ListCapturedOffersUseCase, RetryCapturedOfferUseCase } from '../application/use-cases/CapturedOffersUseCases';

/* Composição do monitoramento de grupos. Tudo lazy: importar não toca banco nem rede. */
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

const monitors  = lazy(() => new PrismaGroupMonitorRepository(prisma));
const captured  = lazy(() => new PrismaCapturedOfferRepository(prisma));
const directory = lazy(() => new ChatMonitorGroupDirectory());
const configDeps = () => ({ monitors: monitors(), directory: directory(), entitlements: offersContainer.entitlements() });

export const automationContainer = {
  getConfig:        lazy(() => new GetGroupMonitorConfigUseCase(configDeps())),
  saveSettings:     lazy(() => new SaveGroupMonitorSettingsUseCase(configDeps())),
  saveMonitored:    lazy(() => new SaveMonitoredGroupsUseCase(configDeps())),
  saveBroadcast:    lazy(() => new SaveBroadcastGroupsUseCase(configDeps())),
  listCaptured:     lazy(() => new ListCapturedOffersUseCase({ captured: captured(), monitors: monitors() })),
  retryCaptured:    lazy(() => new RetryCapturedOfferUseCase({ captured: captured(), monitors: monitors() })),
  registerMessage:  lazy(() => new RegisterCapturedMessageUseCase({ monitors: monitors(), captured: captured() })),
  processCaptured:  lazy(() => new ProcessPendingCapturedOffersUseCase({
    captured: captured(), monitors: monitors(), links: new CampaignsTenantLinkBuilder(), queue: new CampaignsOfferQueue(),
    entitlements: offersContainer.entitlements(),
  })),
};
