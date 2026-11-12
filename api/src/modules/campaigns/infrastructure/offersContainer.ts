import { prisma } from '../../../shared/database/prisma.client';
import { currentWorkerId } from '../../../shared/config/workerIdentity';
import { SecretCipherFactory } from '../../../shared/security/SecretCipherFactory';
import { mediaContainer } from '../../media/infrastructure/mediaContainer';
import { PrismaAffiliateCredentialRepository } from '../../integrations/infrastructure/repositories/PrismaAffiliateCredentialRepository';
import { ResolveAffiliateCredentialUseCase } from '../../integrations/application/use-cases/ResolveAffiliateCredentialUseCase';
import { MarkAffiliateCredentialRejectedUseCase } from '../../integrations/application/use-cases/MarkAffiliateCredentialRejectedUseCase';
import { PrismaAuditLogRepository } from '../../../shared/audit/PrismaAuditLogRepository';
import type { IAffiliateCredentialGateway } from '../domain/contracts/IAffiliateCredentialGateway';
import type { IMarketplaceRiskGate } from '../domain/contracts/IMarketplaceRiskGate';
import { createMarketplaceRiskAcceptanceRepository } from '../../integrations/infrastructure/marketplaceRiskTransaction';
import { isMarketplaceRiskAccepted } from '../../integrations/application/services/requireMarketplaceRiskAccepted';
import { PrismaOfferRepository } from './repositories/PrismaOfferRepository';
import { PrismaOfferDispatchRepository } from './repositories/PrismaOfferDispatchRepository';
import { PrismaOfferGeneratorConfigRepository } from './repositories/PrismaOfferGeneratorConfigRepository';
import { PrismaBroadcastGroupUsageReader } from './repositories/PrismaBroadcastGroupUsageReader';
import { PrismaEntitlementReader } from './repositories/PrismaEntitlementReader';
import { ShopeeAffiliateClient } from './http/ShopeeAffiliateClient';
import { MercadoLivreAffiliateClient } from './http/MercadoLivreAffiliateClient';
import { SheinAffiliateClient } from './http/SheinAffiliateClient';
import { HttpShortLinkExpander } from './http/HttpShortLinkExpander';
import { HttpOfferImageFetcher } from './http/HttpOfferImageFetcher';
import { HttpProductPageReader } from './http/HttpProductPageReader';
import { LazyAiTextGenerator } from './adapters/LazyAiTextGenerator';
import { ResolveProductDataUseCase } from '../application/use-cases/ResolveProductDataUseCase';
import { ResolveAffiliateProductUseCase } from '../application/use-cases/ResolveAffiliateProductUseCase';
import { OfferTextComposer } from '../application/services/OfferTextComposer';
import { TenantAffiliateLinkComposer } from '../application/services/TenantAffiliateLinkComposer';
import { ChatOfferMessageSender } from './adapters/ChatOfferMessageSender';
import { MediaOfferStore } from './adapters/MediaOfferStore';
import { OfferPreviewImage } from './adapters/OfferPreviewImage';
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
import { PrismaSendingPauseStore } from './repositories/PrismaSendingPauseStore';
import { PauseAllSendsUseCase, ResumeAllSendsUseCase } from '../application/use-cases/SendQueueControlUseCases';
import { BuildTenantAffiliateLinkUseCase } from '../application/use-cases/BuildTenantAffiliateLinkUseCase';
import { EnqueueOfferUseCase } from '../application/use-cases/EnqueueOfferUseCase';
import { ListBroadcastGroupsUseCase } from '../application/use-cases/ListBroadcastGroupsUseCase';
import { RemoveBroadcastGroupUseCase } from '../application/use-cases/RemoveBroadcastGroupUseCase';

/*
 * Composição do gerador de ofertas: rotas e worker usam as MESMAS instâncias. Tudo lazy —
 * importar não toca banco, rede nem disco. Engine e media store resolvidos no uso.
 */
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

const offers       = lazy(() => new PrismaOfferRepository(prisma));
const dispatches   = lazy(() => new PrismaOfferDispatchRepository(prisma, currentWorkerId()));
const configs      = lazy(() => new PrismaOfferGeneratorConfigRepository(prisma));
const entitlements = lazy(() => new PrismaEntitlementReader(prisma));
const groupUsage   = lazy(() => new PrismaBroadcastGroupUsageReader(prisma));
const credentialRepo = lazy(() => new PrismaAffiliateCredentialRepository());
// Cifra resolvida no uso: sem chave, só quem decifra falha.
const credentials  = lazy(
  () => new ResolveAffiliateCredentialUseCase(credentialRepo(), () => SecretCipherFactory.get()),
);
// Monitoramento: resolver + estado de rejeição (loja pausada) + marcação com auditoria
const credentialGateway = lazy((): IAffiliateCredentialGateway => {
  const resolver = credentials();
  const mark = new MarkAffiliateCredentialRejectedUseCase(credentialRepo(), new PrismaAuditLogRepository());
  return {
    execute: (t, p) => resolver.execute(t, p),
    resolveState: (t, p) => resolver.resolveState(t, p),
    markRejected: (t, p, code) => mark.execute(t, p, code),
  };
});
// Aceite do aviso de risco (versão vigente do escopo) pelo repositório de integrations
const riskGate = lazy((): IMarketplaceRiskGate => {
  const repo = createMarketplaceRiskAcceptanceRepository();
  return { isAccepted: (t, p, scope) => isMarketplaceRiskAccepted(repo, t, p, scope) };
});
// Uma instância para os três use cases (gerador, monitoramento, vitrine/story)
const shein        = lazy(() => new SheinAffiliateClient());
const mediaStore   = lazy(
  () => new MediaOfferStore({
    files:   () => mediaContainer.mediaFileStore,
    uploads: () => mediaContainer.uploadStore,
    images:  () => mediaContainer.imageTranscoder,
  }),
);
// Prévia de link da oferta: imagens geradas da foto já armazenada
const previewImage = lazy(
  () => new OfferPreviewImage({ files: () => mediaContainer.mediaFileStore, images: () => mediaContainer.imageTranscoder }),
);
const sender       = lazy(() => new ChatOfferMessageSender(undefined, {
  previewImage: previewImage,
  files:        () => mediaContainer.mediaFileStore,
}));
const texts        = lazy(() => new OfferTextComposer(new LazyAiTextGenerator(), entitlements()));

const generate = lazy(() => new GenerateOfferUseCase({
  offers:       offers(),
  entitlements: entitlements(),
  affiliateProducts: affiliateProduct(),
  shopee:       new ShopeeAffiliateClient(),
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
const groupDirectory = lazy(() => new ChatSessionGroupDirectory());
const getConfig  = lazy(() => new GetOfferGeneratorConfigUseCase({ configs: configs(), entitlements: entitlements(), groupUsage: groupUsage(), directory: groupDirectory() }));
const saveConfig = lazy(() => new SaveOfferGeneratorConfigUseCase({ configs: configs(), entitlements: entitlements(), groupUsage: groupUsage(), directory: groupDirectory() }));
const listSessionGroups  = lazy(() => new ListSessionGroupsUseCase({ configs: configs(), directory: groupDirectory() }));
const ensureSessionGroup = lazy(() => new EnsureSessionGroupUseCase({ configs: configs(), directory: groupDirectory() }));
const listBroadcastGroups = lazy(() => new ListBroadcastGroupsUseCase({ groupUsage: groupUsage(), entitlements: entitlements() }));
const removeBroadcastGroup = lazy(() => new RemoveBroadcastGroupUseCase({ groupRemover: groupUsage() }));
const pauses      = lazy(() => new PrismaSendingPauseStore(prisma));
const sendQueue   = lazy(() => new GetSendQueueUseCase({ reader: new PrismaSendQueueReader(prisma), pauses: pauses() }));
const pauseAll    = lazy(() => new PauseAllSendsUseCase({ pauses: pauses() }));
const resumeAll   = lazy(() => new ResumeAllSendsUseCase({ pauses: pauses(), dispatches: dispatches(), configs: configs() }));
// Núcleo do link do tenant (sem expandir, plano nem pausa): monitoramento e, depois, o Resolve
const tenantLinkComposer = lazy(() => new TenantAffiliateLinkComposer({
  shopee: new ShopeeAffiliateClient(),
  mercadoLivre: new MercadoLivreAffiliateClient(),
  pageReader: new HttpProductPageReader(),
  shein: shein(),
  riskGate: riskGate(),
}));
const tenantLinks = lazy(() => new BuildTenantAffiliateLinkUseCase({
  expander: new HttpShortLinkExpander(),
  credentials: credentialGateway(),
  entitlements: entitlements(),
  composer: tenantLinkComposer(),
}));
const enqueue     = lazy(() => new EnqueueOfferUseCase({ offers: offers(), dispatches: dispatches() }));
const products    = lazy(() => new ResolveProductDataUseCase({
  shopee: new ShopeeAffiliateClient(), pageReader: new HttpProductPageReader(), imageFetcher: new HttpOfferImageFetcher(), mediaStore: mediaStore(),
}));
// Link colado → marketplace, dono e dados do produto, sem foto (página de ofertas)
const affiliateProduct = lazy(() => new ResolveAffiliateProductUseCase({
  expander: new HttpShortLinkExpander(), credentials: credentials(), composer: tenantLinkComposer(), products: products(),
  shein: shein(), entitlements: entitlements(), riskGate: riskGate(),
}));
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
  sessionGroupDirectory: groupDirectory,
  processDueDispatches: processDue,
  getSendQueue:         sendQueue,
  pauseAllSends:        pauseAll,
  listBroadcastGroups:  listBroadcastGroups,
  removeBroadcastGroup: removeBroadcastGroup,
  resumeAllSends:       resumeAll,
  // Usados pelo monitoramento de grupos (módulo automation)
  buildTenantAffiliateLink: tenantLinks,
  tenantAffiliateLinkComposer: tenantLinkComposer,
  enqueueOffer:         enqueue,
  entitlements:         entitlements,
  resolveProductData:   products,
  // Usado pela página de ofertas (módulo storefront)
  resolveAffiliateProduct: affiliateProduct,
  offerTexts:           texts,
  credentials:          credentials,
  // Caçador de ofertas: estado da credencial + marcação de recusa (mesmo caminho do monitoramento)
  credentialGateway:    credentialGateway,
  credentialRepo:       credentialRepo,
  // Alerta de aceite pendente do monitoramento (módulo automation)
  riskGate:             riskGate,
};
