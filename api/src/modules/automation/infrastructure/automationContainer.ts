import { prisma } from '../../../shared/database/prisma.client';
import { env } from '../../../shared/config/env';
import { offersContainer } from '../../campaigns/infrastructure/offersContainer';
import { PrismaGroupMonitorRepository } from './repositories/PrismaGroupMonitorRepository';
import { PrismaCapturedOfferRepository } from './repositories/PrismaCapturedOfferRepository';
import { PrismaBroadcastGroupUsageReader } from '../../campaigns/infrastructure/repositories/PrismaBroadcastGroupUsageReader';
import {
  CampaignsCredentialStateSource, CampaignsMonitorImageStore, CampaignsMonitorProductReader, CampaignsMonitorTextComposer, CampaignsOfferQueue,
  CampaignsTenantLinkBuilder, ChatMonitorGroupDirectory,
} from './adapters/CampaignsMonitorAdapters';
import {
  GetGroupMonitorConfigUseCase, SaveBroadcastGroupsUseCase, SaveGroupMonitorSettingsUseCase, SaveMonitoredGroupsUseCase,
} from '../application/use-cases/GroupMonitorConfigUseCases';
import { RegisterCapturedMessageUseCase } from '../application/use-cases/RegisterCapturedMessageUseCase';
import { ProcessPendingCapturedOffersUseCase } from '../application/use-cases/ProcessPendingCapturedOffersUseCase';
import { ListCapturedOffersUseCase, RetryCapturedOfferUseCase } from '../application/use-cases/CapturedOffersUseCases';
import { backgroundProductAccessReader } from '../../tenants/infrastructure/productAccessContainer';
import { featureAudienceReader } from '../../tenants/infrastructure/featureAudience';
import { FeatureAudienceGate } from '../../tenants/application/services/FeatureAudienceGate';

/* Composição do monitoramento de grupos. Tudo lazy: importar não toca banco nem rede. */
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

const monitors  = lazy(() => new PrismaGroupMonitorRepository(prisma));
const captured  = lazy(() => new PrismaCapturedOfferRepository(prisma, { fairClaim: env.MONITORING_FAIR_CLAIM_ENABLED }));
const directory = lazy(() => new ChatMonitorGroupDirectory());
const broadcastUsage = lazy(() => new PrismaBroadcastGroupUsageReader(prisma));
// Portão próprio (sem estado: lê a flag a cada uso), sobre o leitor do tenants: o tenants não importa automation,
// então não há ciclo; não reaproveita o do offersContainer, que só expõe a casca por loja
const featureAudience = lazy(() => new FeatureAudienceGate(featureAudienceReader()));
const configDeps = () => ({
  monitors: monitors(), directory: directory(), entitlements: offersContainer.entitlements(),
  credentialStates: new CampaignsCredentialStateSource(), captured: captured(), broadcastUsage: broadcastUsage(),
  riskGate: offersContainer.riskGate(), audience: offersContainer.marketplaceAudience(), featureAudience: featureAudience(),
});

export const automationContainer = {
  getConfig:        lazy(() => new GetGroupMonitorConfigUseCase(configDeps())),
  saveSettings:     lazy(() => new SaveGroupMonitorSettingsUseCase(configDeps())),
  saveMonitored:    lazy(() => new SaveMonitoredGroupsUseCase(configDeps())),
  saveBroadcast:    lazy(() => new SaveBroadcastGroupsUseCase(configDeps())),
  listCaptured:     lazy(() => new ListCapturedOffersUseCase({ captured: captured(), monitors: monitors() })),
  retryCaptured:    lazy(() => new RetryCapturedOfferUseCase({ captured: captured(), monitors: monitors() })),
  registerMessage:  lazy(() => new RegisterCapturedMessageUseCase({
    monitors: monitors(), captured: captured(), entitlements: offersContainer.entitlements(), products: backgroundProductAccessReader(),
  })),
  processCaptured:  lazy(() => new ProcessPendingCapturedOffersUseCase({
    captured: captured(), monitors: monitors(), links: new CampaignsTenantLinkBuilder(), queue: new CampaignsOfferQueue(),
    entitlements: offersContainer.entitlements(),
    products: new CampaignsMonitorProductReader(), texts: new CampaignsMonitorTextComposer(), images: new CampaignsMonitorImageStore(),
  })),
};
