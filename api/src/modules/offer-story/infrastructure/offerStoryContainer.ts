import { prisma } from '../../../shared/database/prisma.client';
import { PrismaEntitlementReader } from '../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import { offersContainer } from '../../campaigns/infrastructure/offersContainer';
import { HttpOfferImageFetcher } from '../../campaigns/infrastructure/http/HttpOfferImageFetcher';
import { assistantsContainer } from '../../assistants/infrastructure/assistantsContainer';
import type { OfferStoryUseCaseDeps } from '../application/use-cases/offerStoryUseCaseDeps';
import { ListOfferStoryTemplatesUseCase } from '../application/use-cases/ListOfferStoryTemplatesUseCase';
import { RenderOfferStoryUseCase } from '../application/use-cases/RenderOfferStoryUseCase';
import { SatoriOfferStoryRenderer } from './adapters/SatoriOfferStoryRenderer';

/*
 * Composição do Story de Oferta (design.md "Infraestrutura"). Tudo lazy: importar não toca banco,
 * rede nem fontes. Extração e IA vêm dos containers donos (campaigns, assistants).
 */
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

const deps = lazy((): OfferStoryUseCaseDeps => ({
  entitlements:   new PrismaEntitlementReader(prisma),
  resolveProduct: offersContainer.resolveAffiliateProduct(),
  imageFetcher:   new HttpOfferImageFetcher(),
  ai:             assistantsContainer.aiTextGenerator(),
  renderer:       new SatoriOfferStoryRenderer(),
}));

const useCases = lazy(() => ({
  listTemplates: new ListOfferStoryTemplatesUseCase(deps()),
  render:        new RenderOfferStoryUseCase(deps()),
}));

export const offerStoryContainer = {
  /** Use cases do painel do tenant (`/offer-story`). */
  useCases,
};
