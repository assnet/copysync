import { prisma } from '../../../shared/database/prisma.client';
import { SecretCipherFactory } from '../../../shared/security/SecretCipherFactory';
import { mediaContainer } from '../../media/infrastructure/mediaContainer';
import { PrismaAffiliateCredentialRepository } from '../../integrations/infrastructure/repositories/PrismaAffiliateCredentialRepository';
import { ResolveAffiliateCredentialUseCase } from '../../integrations/application/use-cases/ResolveAffiliateCredentialUseCase';
import { PrismaOfferRepository } from './repositories/PrismaOfferRepository';
import { PrismaOfferDispatchRepository } from './repositories/PrismaOfferDispatchRepository';
import { PrismaOfferGeneratorConfigRepository } from './repositories/PrismaOfferGeneratorConfigRepository';
import { PrismaEntitlementReader } from './repositories/PrismaEntitlementReader';
import { ShopeeAffiliateClient } from './http/ShopeeAffiliateClient';
import { MercadoLivreAffiliateClient } from './http/MercadoLivreAffiliateClient';
import { HttpShortLinkExpander } from './http/HttpShortLinkExpander';
import { HttpOfferImageFetcher } from './http/HttpOfferImageFetcher';
import { HttpProductPageReader } from './http/HttpProductPageReader';
import { LazyAiTextGenerator } from './adapters/LazyAiTextGenerator';
import { OfferTextComposer } from '../application/services/OfferTextComposer';
import { ChatOfferMessageSender } from './adapters/ChatOfferMessageSender';
import { MediaOfferStore } from './adapters/MediaOfferStore';
import { GenerateOfferUseCase } from '../application/use-cases/GenerateOfferUseCase';
import { GetOfferUseCase } from '../application/use-cases/GetOfferUseCase';
import { GetOfferUsageUseCase } from '../application/use-cases/GetOfferUsageUseCase';
import { UpdateOfferUseCase } from '../application/use-cases/UpdateOfferUseCase';
import { SendOfferUseCase } from '../application/use-cases/SendOfferUseCase';
import { RegenerateOfferTextUseCase } from '../application/use-cases/RegenerateOfferTextUseCase';
import {
  GetOfferGeneratorConfigUseCase,
  SaveOfferGeneratorConfigUseCase,
} from '../application/use-cases/OfferGeneratorConfigUseCases';
import { CancelOfferUseCase, PauseOfferUseCase, ResumeOfferUseCase } from '../application/use-cases/OfferSendControlUseCases';
import { ProcessDueOfferDispatchesUseCase } from '../application/use-cases/ProcessDueOfferDispatchesUseCase';
import { EnsureSessionGroupUseCase, ListSessionGroupsUseCase } from '../application/use-cases/SessionGroupsUseCases';
import { ChatSessionGroupDirectory } from './adapters/ChatSessionGroupDirectory';
import { PrismaSendQueueReader } from './repositories/PrismaSendQueueReader';
import { GetSendQueueUseCase } from '../application/use-cases/GetSendQueueUseCase';
import { BuildTenantAffiliateLinkUseCase } from '../application/use-cases/BuildTenantAffiliateLinkUseCase';
import { EnqueueOfferUseCase } from '../application/use-cases/EnqueueOfferUseCase';

/*
 * Composição do gerador de ofertas: rotas e worker usam as MESMAS instâncias. Tudo lazy —
 * importar não toca banco, rede nem disco. Engine e media store resolvidos no uso.
 */
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

const offers       = lazy(() => new PrismaOfferRepository(prisma));
const dispatches   = lazy(() => new PrismaOfferDispatchRepository(prisma));
const configs      = lazy(() => new PrismaOfferGeneratorConfigRepository(prisma));
const entitlements = lazy(() => new PrismaEntitlementReader(prisma));
// Cifra resolvida no uso: sem chave, só quem decifra falha.
const credentials  = lazy(
  () => new ResolveAffiliateCredentialUseCase(new PrismaAffiliateCredentialRepository(), () => SecretCipherFactory.get()),
);
const mediaStore   = lazy(
  () => new MediaOfferStore({ files: () => mediaContainer.mediaFileStore, uploads: () => mediaContainer.uploadStore }),
);
const sender       = lazy(() => new ChatOfferMessageSender());
const texts        = lazy(() => new OfferTextComposer(new LazyAiTextGenerator()));

const generate = lazy(() => new GenerateOfferUseCase({
  offers:       offers(),
  entitlements: entitlements(),
  expander:     new HttpShortLinkExpander(),
  credentials:  credentials(),
  shopee:       new ShopeeAffiliateClient(),
  mercadoLivre: new MercadoLivreAffiliateClient(),
  pageReader:   new HttpProductPageReader(),
  imageFetcher: new HttpOfferImageFetcher(),
  mediaStore:   mediaStore(),
  texts:        texts(),
}));
const get       = lazy(() => new GetOfferUseCase(offers(), dispatches()));
const usage     = lazy(() => new GetOfferUsageUseCase(offers(), entitlements()));
const update    = lazy(() => new UpdateOfferUseCase({ offers: offers(), mediaStore: mediaStore() }));
const regenerate = lazy(() => new RegenerateOfferTextUseCase({ offers: offers(), texts: texts() }));
const send      = lazy(() => new SendOfferUseCase({
  offers: offers(), dispatches: dispatches(), configs: configs(), entitlements: entitlements(),
}));
const controlDeps = () => ({ offers: offers(), dispatches: dispatches(), configs: configs() });
const pause     = lazy(() => new PauseOfferUseCase(controlDeps()));
const resume    = lazy(() => new ResumeOfferUseCase(controlDeps()));
const cancel    = lazy(() => new CancelOfferUseCase(controlDeps()));
const getConfig  = lazy(() => new GetOfferGeneratorConfigUseCase({ configs: configs(), entitlements: entitlements() }));
const saveConfig = lazy(() => new SaveOfferGeneratorConfigUseCase({ configs: configs(), entitlements: entitlements() }));
const groupDirectory = lazy(() => new ChatSessionGroupDirectory());
const listSessionGroups  = lazy(() => new ListSessionGroupsUseCase({ configs: configs(), directory: groupDirectory() }));
const ensureSessionGroup = lazy(() => new EnsureSessionGroupUseCase({ configs: configs(), directory: groupDirectory() }));
const sendQueue   = lazy(() => new GetSendQueueUseCase({ reader: new PrismaSendQueueReader(prisma) }));
const tenantLinks = lazy(() => new BuildTenantAffiliateLinkUseCase({
  expander: new HttpShortLinkExpander(),
  credentials: credentials(),
  shopee: new ShopeeAffiliateClient(),
  mercadoLivre: new MercadoLivreAffiliateClient(),
  pageReader: new HttpProductPageReader(),
}));
const enqueue     = lazy(() => new EnqueueOfferUseCase({ offers: offers(), dispatches: dispatches() }));
const processDue  = lazy(() => new ProcessDueOfferDispatchesUseCase({
  offers: offers(), dispatches: dispatches(), sender: sender(),
}));

export const offersContainer = {
  generateOffer:        generate,
  getOffer:             get,
  getOfferUsage:        usage,
  updateOffer:          update,
  regenerateOfferText:  regenerate,
  sendOffer:            send,
  pauseOffer:           pause,
  resumeOffer:          resume,
  cancelOffer:          cancel,
  getConfig:            getConfig,
  saveConfig:           saveConfig,
  listSessionGroups:    listSessionGroups,
  ensureSessionGroup:   ensureSessionGroup,
  processDueDispatches: processDue,
  getSendQueue:         sendQueue,
  // Usados pelo monitoramento de grupos (módulo automation)
  buildTenantAffiliateLink: tenantLinks,
  enqueueOffer:         enqueue,
  entitlements:         entitlements,
};
