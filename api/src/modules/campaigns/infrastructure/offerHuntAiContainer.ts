import { prisma } from '../../../shared/database/prisma.client';
import { offersContainer } from './offersContainer';
import { hunterContainer } from './hunterContainer';
import { LazyAiTextGenerator } from './adapters/LazyAiTextGenerator';
import { LazyHuntAiAvailability } from './adapters/LazyHuntAiAvailability';
import { PrismaOfferHuntAiSuggestionCounter } from './repositories/hunter/PrismaOfferHuntAiSuggestionCounter';
import { AiHuntConfigSuggester } from '../application/services/hunter/AiHuntConfigSuggester';
import { SuggestHuntConfigUseCase } from '../application/use-cases/hunter/SuggestHuntConfigUseCase';

/*
 * Composição da IA que configura a caçada (`POST /offer-hunts/ai-suggest`). Lazy como o `hunterContainer`:
 * importar não toca banco, rede nem provedor de IA. Credencial, aceite e entitlements vêm do gerador.
 * Registry de marcas = o mesmo do `hunterContainer` (um só, com os adaptadores reais).
 */
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

const suggestHuntConfig = lazy(() => new SuggestHuntConfigUseCase({
  entitlements: offersContainer.entitlements(),
  riskGate: offersContainer.riskGate(),
  credentials: offersContainer.credentialGateway(),
  ai: new LazyHuntAiAvailability(),
  registry: hunterContainer.huntProviders(),
  suggester: new AiHuntConfigSuggester(new LazyAiTextGenerator()),
  counter: new PrismaOfferHuntAiSuggestionCounter(prisma),
}));

export const offerHuntAiContainer = { suggestHuntConfig };
