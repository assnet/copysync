import { promises as fs } from 'fs';
import { prisma } from '../../../shared/database/prisma.client';
import { env } from '../../../shared/config/env';
import { PrismaEntitlementReader } from '../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import { mediaContainer } from '../../media/infrastructure/mediaContainer';
import { offersContainer } from '../../campaigns/infrastructure/offersContainer';
import { HttpOfferImageFetcher } from '../../campaigns/infrastructure/http/HttpOfferImageFetcher';
import { linkRotationContainer } from '../../link-rotation/infrastructure/linkRotationContainer';
import type {
  StorefrontSlugTransaction,
  StorefrontUseCaseDeps,
} from '../application/use-cases/storefrontUseCaseDeps';
import { GetStorefrontUseCase } from '../application/use-cases/GetStorefrontUseCase';
import { CheckStorefrontSlugUseCase } from '../application/use-cases/CheckStorefrontSlugUseCase';
import { SaveStorefrontUseCase } from '../application/use-cases/SaveStorefrontUseCase';
import { SetStorefrontImageUseCase } from '../application/use-cases/SetStorefrontImageUseCase';
import { RemoveStorefrontImageUseCase } from '../application/use-cases/RemoveStorefrontImageUseCase';
import { PreviewStorefrontUseCase } from '../application/use-cases/PreviewStorefrontUseCase';
import { ExtractStorefrontOfferUseCase } from '../application/use-cases/ExtractStorefrontOfferUseCase';
import { UpdateStorefrontOfferUseCase } from '../application/use-cases/UpdateStorefrontOfferUseCase';
import { SetStorefrontOfferStatusUseCase } from '../application/use-cases/SetStorefrontOfferStatusUseCase';
import { ReorderStorefrontOffersUseCase } from '../application/use-cases/ReorderStorefrontOffersUseCase';
import { DeleteStorefrontOfferUseCase } from '../application/use-cases/DeleteStorefrontOfferUseCase';
import { RenderPublicStorefrontUseCase } from '../application/use-cases/RenderPublicStorefrontUseCase';
import type { IPublicPageRenderer } from '../domain/contracts/IPublicPageRenderer';
import { createStorefrontPageTemplate } from '../presentation/templates/storefrontPageTemplate';
import { PrismaStorefrontRepository } from './repositories/PrismaStorefrontRepository';
import { PrismaStorefrontOfferRepository } from './repositories/PrismaStorefrontOfferRepository';
import { SharpStorefrontImageProcessor } from './adapters/SharpStorefrontImageProcessor';
import { StorefrontMediaStore } from './adapters/StorefrontMediaStore';

/*
 * Composição da Página de Ofertas (design.md §4.3). Tudo lazy: importar não toca banco, disco nem
 * rede. Painel e hook público usam as mesmas instâncias. Media store e upload resolvidos no uso.
 */
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

/** Claim do nome + página + ofertas no mesmo `tx` (transação do namespace do rodízio). */
const slugTransaction: StorefrontSlugTransaction = (fn) =>
  linkRotationContainer.runInSlugTransaction(({ slugs, tx }) =>
    fn({ slugs, storefronts: new PrismaStorefrontRepository(tx), offers: new PrismaStorefrontOfferRepository(tx) }),
  );

const storefronts = lazy(() => new PrismaStorefrontRepository(prisma));
const offers      = lazy(() => new PrismaStorefrontOfferRepository(prisma));

const deps = lazy((): StorefrontUseCaseDeps => ({
  storefronts:  storefronts(),
  offers:       offers(),
  entitlements: new PrismaEntitlementReader(prisma),
  images:       new SharpStorefrontImageProcessor(),
  media:        new StorefrontMediaStore({ files: () => mediaContainer.mediaFileStore }),
  // Getter do container: o store de upload só nasce no 1º uso.
  uploads: {
    beginConsume:   (...a) => mediaContainer.uploadStore.beginConsume(...a),
    releaseConsume: (...a) => mediaContainer.uploadStore.releaseConsume(...a),
    discard:        (...a) => mediaContainer.uploadStore.discard(...a),
    binPath:        (...a) => mediaContainer.uploadStore.binPath(...a),
  },
  readFile:           (path) => fs.readFile(path),
  resolveProduct:     offersContainer.resolveAffiliateProduct(),
  buildAffiliateLink: offersContainer.buildTenantAffiliateLink(),
  imageFetcher:       new HttpOfferImageFetcher(),
  slugs:              linkRotationContainer.publicSlugRegistry,
  runInSlugTransaction: slugTransaction,
  domains:            linkRotationContainer.domainRepository,
  // Mesmas origens da página do rodízio (`publicLinkComposition`).
  template: createStorefrontPageTemplate({ mediaOrigin: env.S3_PUBLIC_URL ?? null, assetBaseUrl: env.PANEL_URL ?? null }),
}));

const useCases = lazy(() => ({
  get:          new GetStorefrontUseCase(deps()),
  checkSlug:    new CheckStorefrontSlugUseCase(deps()),
  save:         new SaveStorefrontUseCase(deps()),
  setImage:     new SetStorefrontImageUseCase(deps()),
  removeImage:  new RemoveStorefrontImageUseCase(deps()),
  preview:      new PreviewStorefrontUseCase(deps()),
  extractOffer: new ExtractStorefrontOfferUseCase(deps()),
  updateOffer:  new UpdateStorefrontOfferUseCase(deps()),
  setOfferStatus: new SetStorefrontOfferStatusUseCase(deps()),
  reorderOffers:  new ReorderStorefrontOffersUseCase(deps()),
  deleteOffer:  new DeleteStorefrontOfferUseCase(deps()),
}));

const publicRenderer = lazy(() => new RenderPublicStorefrontUseCase(deps()));

export const storefrontContainer = {
  /** Use cases do painel do tenant (`/storefront`). */
  useCases,
  /** Página pública `<slug>.<domínio>`, injetada no hook do rodízio (`app.ts`). */
  // Delegação: o boot só guarda a referência; deps nascem na 1ª página servida.
  publicRenderer: { render: (address) => publicRenderer().render(address) } satisfies IPublicPageRenderer,
};
