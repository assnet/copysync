import type { AiAdapterTarget, IAiTextProviderAdapter } from '../../domain/contracts/IAiTextProviderAdapter';
import type { IAiBaseUrlGuard } from '../../domain/contracts/IAiBaseUrlGuard';
import type { AiProviderKind } from '../../domain/enums/AiProviderKind';
import { AI_PROVIDER_CATALOG } from '../../domain/services/aiProviderCatalog';
import { AiProviderRejectedError } from '../../../../shared/errors/internal/AiErrors';
import { AnthropicTextAdapter } from './AnthropicTextAdapter';
import { OpenAiCompatibleTextAdapter } from './OpenAiCompatibleTextAdapter';
import { DnsAiBaseUrlGuard } from './DnsAiBaseUrlGuard';
import type { FetchFn } from './httpAiErrors';

const missingBaseUrl: IAiTextProviderAdapter = {
  generate: async () => { throw new AiProviderRejectedError(); },
};

/**
 * Adapter pelo protocolo do catálogo. URL fixa = instância única; endpoint próprio = instância
 * por chamada, com o guard de DNS antes do fetch. Novo provedor = entrada no catálogo + enum.
 */
export function createAiTextProviderAdapterFactory(
  fetchFn: FetchFn = fetch,
  guard: IAiBaseUrlGuard = new DnsAiBaseUrlGuard(),
) {
  const fixed = new Map<AiProviderKind, IAiTextProviderAdapter>();
  for (const e of AI_PROVIDER_CATALOG) {
    if (e.protocol === 'anthropic') fixed.set(e.kind, new AnthropicTextAdapter(fetchFn));
    else if (e.baseUrl) {
      fixed.set(e.kind, new OpenAiCompatibleTextAdapter({ baseUrl: e.baseUrl, maxTokensParam: e.maxTokensParam, fetchFn }));
    }
  }
  return ({ kind, baseUrl }: AiAdapterTarget): IAiTextProviderAdapter => {
    const adapter = fixed.get(kind);
    if (adapter) return adapter;
    if (!baseUrl) return missingBaseUrl;
    const entry = AI_PROVIDER_CATALOG.find((e) => e.kind === kind)!;
    return new OpenAiCompatibleTextAdapter({ baseUrl, maxTokensParam: entry.maxTokensParam, guard, fetchFn });
  };
}
