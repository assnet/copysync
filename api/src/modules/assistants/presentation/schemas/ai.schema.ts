import { AI_PROVIDER_KINDS } from '../../domain/enums/AiProviderKind';
import { AI_PROVIDER_CATALOG } from '../../domain/services/aiProviderCatalog';
import { CUSTOM_BASE_URL_MAX_LENGTH } from '../../domain/services/customBaseUrl';

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
/** Forma fina (https, host público) no use case; aqui só o teto. */
const baseUrl = { type: ['string', 'null'], maxLength: CUSTOM_BASE_URL_MAX_LENGTH } as const;
const tenantKind = {
  type: 'string',
  enum: AI_PROVIDER_CATALOG.filter((e) => e.tenantAllowed).map((e) => e.kind),
} as const;

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
    baseUrl: { type: ['string', 'null'] },
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
  properties: { kind, label, model, apiKey, enabled: { type: 'boolean' }, priority, dailyLimitPerTenant: dailyLimit, baseUrl },
} as const;

export const updateAiProviderBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: { label, model, apiKey, enabled: { type: 'boolean' }, priority, dailyLimitPerTenant: dailyLimit, baseUrl },
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
  properties: { kind: tenantKind, model, apiKey, enabled: { type: 'boolean' } },
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

export const aiCatalogResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind,
          label: { type: 'string' },
          defaultModel: { type: ['string', 'null'] },
          requiresBaseUrl: { type: 'boolean' },
          tenantAllowed: { type: 'boolean' },
        },
      },
    },
  },
});
