import { AI_PROVIDER_KINDS } from '../../domain/enums/AiProviderKind';

/*
 * Schemas fechados (`additionalProperties: false`) na entrada e na saída: o serializer do
 * Fastify descarta qualquer campo fora da lista, então chave nunca vaza por engano.
 * Formato fino de modelo e chave é validado no use case (422 com `meta.field`).
 */
const kind = { type: 'string', enum: [...AI_PROVIDER_KINDS] } as const;
const model = { type: 'string', maxLength: 120 } as const;
const apiKey = { type: 'string', maxLength: 512 } as const;
const label = { type: 'string', minLength: 1, maxLength: 80 } as const;
const priority = { type: 'integer', minimum: 0, maximum: 1000 } as const;
const dailyLimit = { type: ['integer', 'null'], minimum: 1, maximum: 1_000_000 } as const;

const envelope = (data: object) => ({
  type: 'object',
  additionalProperties: false,
  properties: { success: { type: 'boolean' }, data },
});

const settings = {
  type: 'object',
  additionalProperties: false,
  required: ['platformEnabled', 'tenantKeysEnabled'],
  properties: { platformEnabled: { type: 'boolean' }, tenantKeysEnabled: { type: 'boolean' } },
} as const;

const provider = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    kind,
    label: { type: 'string' },
    model: { type: 'string' },
    enabled: { type: 'boolean' },
    priority: { type: 'integer' },
    dailyLimitPerTenant: { type: ['integer', 'null'] },
    hasKey: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const credential = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind,
    model: { type: 'string' },
    masked: { type: 'string' },
    enabled: { type: 'boolean' },
  },
} as const;

const testResult = {
  type: 'object',
  additionalProperties: false,
  properties: { ok: { type: 'boolean' }, errorCode: { type: 'string' } },
} as const;

export const aiSettingsBodySchema = settings;
export const aiSettingsResponse = envelope(settings);

export const aiProviderIdParamSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

export const createAiProviderBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'label', 'apiKey'],
  properties: { kind, label, model, apiKey, enabled: { type: 'boolean' }, priority, dailyLimitPerTenant: dailyLimit },
} as const;

export const updateAiProviderBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: { label, model, apiKey, enabled: { type: 'boolean' }, priority, dailyLimitPerTenant: dailyLimit },
} as const;

export const aiProviderResponse = envelope(provider);
export const aiProviderListResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: { items: { type: 'array', items: provider } },
});

export const upsertAiCredentialBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind'],
  properties: { kind, model, apiKey, enabled: { type: 'boolean' } },
} as const;

export const aiCredentialResponse = envelope(credential);

export const aiStatusResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: { type: 'string', enum: ['PLATFORM', 'TENANT', 'NONE'] },
    tenantKeysAllowed: { type: 'boolean' },
    platformAvailable: { type: 'boolean' },
    credential: { ...credential, type: ['object', 'null'] },
  },
});

export const aiTestResponse = envelope(testResult);
