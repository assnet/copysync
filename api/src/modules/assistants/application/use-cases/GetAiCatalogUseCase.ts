import { AI_PROVIDER_CATALOG } from '../../domain/services/aiProviderCatalog';
import type { AiCatalogItemDTO } from '../dtos/AiDTO';

/** Catálogo de provedores para o painel (sem URL nem detalhe de protocolo). */
export class GetAiCatalogUseCase {
  execute(): AiCatalogItemDTO[] {
    return AI_PROVIDER_CATALOG.map(({ kind, label, defaultModel, requiresBaseUrl, tenantAllowed }) => ({
      kind, label, defaultModel, requiresBaseUrl, tenantAllowed,
    }));
  }
}
