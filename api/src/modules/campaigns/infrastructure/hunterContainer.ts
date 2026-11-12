import { prisma } from '../../../shared/database/prisma.client';
import { offersContainer } from './offersContainer';
import { PrismaOfferHuntRepository } from './repositories/hunter/PrismaOfferHuntRepository';
import { PrismaOfferHuntRunRepository } from './repositories/hunter/PrismaOfferHuntRunRepository';
import { PrismaOfferHuntFindRepository } from './repositories/hunter/PrismaOfferHuntFindRepository';
import { PrismaOfferHunterSettingsRepository } from './repositories/hunter/PrismaOfferHunterSettingsRepository';
import { PrismaOfferGeneratorConfigRepository } from './repositories/PrismaOfferGeneratorConfigRepository';
import { PrismaBroadcastGroupUsageReader } from './repositories/PrismaBroadcastGroupUsageReader';
import { SheinCatalogClient } from './http/SheinCatalogClient';
import { LazyAiTextGenerator } from './adapters/LazyAiTextGenerator';
import { AiHuntCandidateRanker } from '../application/services/hunter/AiHuntCandidateRanker';
import { HuntFindDelivery } from '../application/services/hunter/HuntFindDelivery';
import { RunOfferHuntUseCase } from '../application/use-cases/hunter/RunOfferHuntUseCase';
import { ApproveHuntFindUseCase, DismissHuntFindUseCase } from '../application/use-cases/hunter/HuntFindDecisionUseCases';
import { SetOfferHunterDestinationUseCase } from '../application/use-cases/hunter/SetOfferHunterDestinationUseCase';
import {
  CreateOfferHuntUseCase, DeleteOfferHuntUseCase, GetOfferHuntUseCase, ListOfferHuntsUseCase, PauseOfferHuntUseCase,
  ResumeOfferHuntUseCase, UpdateOfferHuntUseCase, type OfferHuntCrudDeps,
} from '../application/use-cases/hunter/OfferHuntCrudUseCases';
import { ListOfferHuntFindsUseCase, ListOfferHuntRunsUseCase } from '../application/use-cases/hunter/OfferHuntHistoryUseCases';
import {
  GetOfferHunterDestinationUseCase, GetOfferHunterOptionsUseCase, GetOfferHunterUsageUseCase,
} from '../application/use-cases/hunter/OfferHunterInfoUseCases';
import { OfferHunterAudienceGate } from '../application/services/hunter/offerHunterAudience';
import { LazyHuntAiAvailability } from './adapters/LazyHuntAiAvailability';

/*
 * Composição do Caçador de Ofertas (mesmo padrão lazy do `offersContainer`: importar não toca banco,
 * rede nem disco). Link, texto, foto, credencial, aceite e entitlements vêm das instâncias do gerador.
 */
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

const hunts    = lazy(() => new PrismaOfferHuntRepository(prisma));
const runs     = lazy(() => new PrismaOfferHuntRunRepository(prisma));
const finds    = lazy(() => new PrismaOfferHuntFindRepository(prisma));
const settings = lazy(() => new PrismaOfferHunterSettingsRepository(prisma));
const configs  = lazy(() => new PrismaOfferGeneratorConfigRepository(prisma));
const groupUsage = lazy(() => new PrismaBroadcastGroupUsageReader(prisma));
const catalog  = lazy(() => new SheinCatalogClient());
const ranker   = lazy(() => new AiHuntCandidateRanker(new LazyAiTextGenerator()));

const delivery = lazy(() => new HuntFindDelivery({
  finds: finds(),
  runs: runs(),
  settings: settings(),
  affiliateProducts: offersContainer.resolveAffiliateProduct(),
  texts: offersContainer.offerTexts(),
  images: offersContainer.resolveProductData(),
  enqueue: offersContainer.enqueueOffer(),
  configs: configs(),
}));

const runHunt = lazy(() => new RunOfferHuntUseCase({
  hunts: hunts(),
  runs: runs(),
  finds: finds(),
  catalog: catalog(),
  credentials: offersContainer.credentialGateway(),
  entitlements: offersContainer.entitlements(),
  riskGate: offersContainer.riskGate(),
  ranker: ranker(),
  delivery: delivery(),
}));
const approveFind = lazy(() => new ApproveHuntFindUseCase({ finds: finds(), entitlements: offersContainer.entitlements(), delivery: delivery() }));
const dismissFind = lazy(() => new DismissHuntFindUseCase({ finds: finds() }));
const setDestination = lazy(() => new SetOfferHunterDestinationUseCase({
  settings: settings(), configs: configs(), groupUsage: groupUsage(), entitlements: offersContainer.entitlements(),
}));

const crudDeps = (): OfferHuntCrudDeps => ({ hunts: hunts(), entitlements: offersContainer.entitlements() });
const createHunt = lazy(() => new CreateOfferHuntUseCase(crudDeps()));
const updateHunt = lazy(() => new UpdateOfferHuntUseCase(crudDeps()));
const deleteHunt = lazy(() => new DeleteOfferHuntUseCase(crudDeps()));
const pauseHunt  = lazy(() => new PauseOfferHuntUseCase(crudDeps()));
const resumeHunt = lazy(() => new ResumeOfferHuntUseCase(crudDeps()));
const getHunt    = lazy(() => new GetOfferHuntUseCase(crudDeps()));
const listHunts  = lazy(() => new ListOfferHuntsUseCase(crudDeps()));
const listRuns   = lazy(() => new ListOfferHuntRunsUseCase({ hunts: hunts(), runs: runs() }));
const listFinds  = lazy(() => new ListOfferHuntFindsUseCase({ hunts: hunts(), finds: finds() }));
const usage      = lazy(() => new GetOfferHunterUsageUseCase({ finds: finds(), runs: runs(), entitlements: offersContainer.entitlements() }));
const options    = lazy(() => new GetOfferHunterOptionsUseCase({
  entitlements: offersContainer.entitlements(),
  credentials: offersContainer.credentialGateway(),
  riskGate: offersContainer.riskGate(),
  ai: new LazyHuntAiAvailability(),
  settings: settings(),
  catalog: catalog(),
}));
const getDestination = lazy(() => new GetOfferHunterDestinationUseCase({ settings: settings(), configs: configs() }));
const audienceGate = lazy(() => new OfferHunterAudienceGate(offersContainer.entitlements()));

export const hunterContainer = {
  hunts,
  runs,
  finds,
  settings,
  runOfferHunt:          runHunt,
  approveHuntFind:       approveFind,
  dismissHuntFind:       dismissFind,
  setOfferHunterDestination: setDestination,
  createOfferHunt:       createHunt,
  updateOfferHunt:       updateHunt,
  deleteOfferHunt:       deleteHunt,
  pauseOfferHunt:        pauseHunt,
  resumeOfferHunt:       resumeHunt,
  getOfferHunt:          getHunt,
  listOfferHunts:        listHunts,
  listOfferHuntRuns:     listRuns,
  listOfferHuntFinds:    listFinds,
  getOfferHunterUsage:   usage,
  getOfferHunterOptions: options,
  getOfferHunterDestination: getDestination,
  audienceGate,
};
