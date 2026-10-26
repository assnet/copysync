import { AiCredentialInvalidError } from '../../../../shared/errors/internal/AiErrors';
import { normalizeApiKey } from '../../domain/services/aiProviderDefaults';
import { aiProviderCatalogEntry } from '../../domain/services/aiProviderCatalog';
import { checkCustomBaseUrl } from '../../domain/services/customBaseUrl';
import type { IAiBaseUrlGuard } from '../../domain/contracts/IAiBaseUrlGuard';
import type { AiProviderKind } from '../../domain/enums/AiProviderKind';

const MODEL_RE = /^[A-Za-z0-9~][A-Za-z0-9._:/@~-]{0,119}$/;
const KEY_RE = /^[\x21-\x7e]{8,512}$/;

/** Modelo vazio = padrão do catálogo (sem padrão = obrigatório). Inválido = 422 com o campo. */
export function resolveModel(kind: AiProviderKind, raw?: string): string {
  const model = raw?.trim() ?? '';
  if (!model) {
    const fallback = aiProviderCatalogEntry(kind).defaultModel;
    if (!fallback) throw new AiCredentialInvalidError('Model is required', 'model');
    return fallback;
  }
  if (!MODEL_RE.test(model)) throw new AiCredentialInvalidError('Invalid model', 'model');
  return model;
}

/** Chave vazia = null. Chave com espaço interno ou fora do tamanho = 422 com o campo. */
export function validateApiKey(raw?: string | null): string | null {
  const key = normalizeApiKey(raw);
  if (key === null) return null;
  if (!KEY_RE.test(key)) throw new AiCredentialInvalidError('Invalid API key', 'apiKey');
  return key;
}

/**
 * URL base de um provedor da plataforma. Tipos com URL fixa ignoram o campo (null). Endpoint
 * próprio: forma (`checkCustomBaseUrl`) + DNS público (`guard`); falha = 422 `field: baseUrl`.
 */
export async function resolveBaseUrl(
  kind: AiProviderKind,
  raw: string | null | undefined,
  guard: IAiBaseUrlGuard,
): Promise<string | null> {
  if (!aiProviderCatalogEntry(kind).requiresBaseUrl) return null;
  const shape = checkCustomBaseUrl(raw);
  if (!shape.ok) throw new AiCredentialInvalidError(`Invalid base URL (${shape.reason})`, 'baseUrl');
  const verdict = await guard.check(shape.url);
  if (verdict !== 'ok') throw new AiCredentialInvalidError(`Invalid base URL (${verdict})`, 'baseUrl');
  return shape.url;
}

/** Tenant nunca aponta para URL arbitrária: `OPENAI_COMPATIBLE` é só da plataforma. */
export function assertTenantKind(kind: AiProviderKind): void {
  if (!aiProviderCatalogEntry(kind).tenantAllowed) {
    throw new AiCredentialInvalidError('Provider not allowed for tenant keys', 'kind');
  }
}
