import { prisma } from '../../../shared/database/prisma.client';
import { SecretCipherFactory } from '../../../shared/security/SecretCipherFactory';
import { mediaContainer } from '../../media/infrastructure/mediaContainer';
import { PrismaAffiliateCredentialRepository } from '../../integrations/infrastructure/repositories/PrismaAffiliateCredentialRepository';
import { ResolveAffiliateCredentialUseCase } from '../../integrations/application/use-cases/ResolveAffiliateCredentialUseCase';
import { PrismaOfferRepository } from './repositories/PrismaOfferRepository';
import { PrismaOfferDispatchRepository } from './repositories/PrismaOfferDispatchRepository';
import { PrismaOfferDestinationRepository } from './repositories/PrismaOfferDestinationRepository';
import { PrismaEntitlementReader } from './repositories/PrismaEntitlementReader';
import { ShopeeAffiliateClient } from './http/ShopeeAffiliateClient';
import { HttpShortLinkExpander } from './http/HttpShortLinkExpander';
import { HttpOfferImageFetcher } from './http/HttpOfferImageFetcher';
import { ChatOfferMessageSender } from './adapters/ChatOfferMessageSender';
import { MediaOfferStore } from './adapters/MediaOfferStore';
import { GenerateOfferUseCase } from '../application/use-cases/GenerateOfferUseCase';
import { GetOfferUseCase } from '../application/use-cases/GetOfferUseCase';
import { GetOfferUsageUseCase } from '../application/use-cases/GetOfferUsageUseCase';
import { UpdateOfferUseCase } from '../application/use-cases/UpdateOfferUseCase';
import { SendOfferUseCase } from '../application/use-cases/SendOfferUseCase';
import { ListOfferDestinationsUseCase } from '../application/use-cases/ListOfferDestinationsUseCase';
import { ReplaceOfferDestinationsUseCase } from '../application/use-cases/ReplaceOfferDestinationsUseCase';
import { ProcessDueOfferDispatchesUseCase } from '../application/use-cases/ProcessDueOfferDispatchesUseCase';

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
const destinations = lazy(() => new PrismaOfferDestinationRepository(prisma));
const entitlements = lazy(() => new PrismaEntitlementReader(prisma));
// Cifra resolvida no uso: sem chave, só quem decifra falha.
const credentials  = lazy(
  () => new ResolveAffiliateCredentialUseCase(new PrismaAffiliateCredentialRepository(), () => SecretCipherFactory.get()),
);
const mediaStore   = lazy(
  () => new MediaOfferStore({ files: () => mediaContainer.mediaFileStore, uploads: () => mediaContainer.uploadStore }),
);
const sender       = lazy(() => new ChatOfferMessageSender());

const generate = lazy(() => new GenerateOfferUseCase({
  offers:       offers(),
  entitlements: entitlements(),
  expander:     new HttpShortLinkExpander(),
  credentials:  credentials(),
  shopee:       new ShopeeAffiliateClient(),
  imageFetcher: new HttpOfferImageFetcher(),
  mediaStore:   mediaStore(),
}));
const get       = lazy(() => new GetOfferUseCase(offers(), dispatches()));
const usage     = lazy(() => new GetOfferUsageUseCase(offers(), entitlements()));
const update    = lazy(() => new UpdateOfferUseCase({ offers: offers(), mediaStore: mediaStore() }));
const send      = lazy(() => new SendOfferUseCase({ offers: offers(), dispatches: dispatches(), destinations: destinations() }));
const listDest  = lazy(() => new ListOfferDestinationsUseCase(destinations()));
const replaceDest = lazy(() => new ReplaceOfferDestinationsUseCase(destinations()));
const processDue  = lazy(() => new ProcessDueOfferDispatchesUseCase({
  offers: offers(), dispatches: dispatches(), sender: sender(),
}));

export const offersContainer = {
  generateOffer:        generate,
  getOffer:             get,
  getOfferUsage:        usage,
  updateOffer:          update,
  sendOffer:            send,
  listDestinations:     listDest,
  replaceDestinations:  replaceDest,
  processDueDispatches: processDue,
};
