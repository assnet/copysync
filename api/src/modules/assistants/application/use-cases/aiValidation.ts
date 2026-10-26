import { AiCredentialInvalidError } from '../../../../shared/errors/internal/AiErrors';
import { DEFAULT_AI_MODEL, normalizeApiKey } from '../../domain/services/aiProviderDefaults';
import type { AiProviderKind } from '../../domain/enums/AiProviderKind';

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const KEY_RE = /^[\x21-\x7e]{8,512}$/;

/** Modelo vazio = padrão do tipo. Inválido = 422 com o campo. */
export function resolveModel(kind: AiProviderKind, raw?: string): string {
  const model = raw?.trim() ?? '';
  if (!model) return DEFAULT_AI_MODEL[kind];
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
