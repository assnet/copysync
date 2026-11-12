/**
 * Schemas de `/admin/costs` (super admin). Espelham `app/src/features/infraCosts/types.ts`.
 * `additionalProperties: false` em tudo: campo fora do contrato (ex.: id da Render) nunca sai.
 */
import {
  INFRA_COST_ALLOCATIONS,
  INFRA_COST_BILLINGS,
  INFRA_COST_CATEGORIES,
  INFRA_FX_CLOSING_METHODS,
  INFRA_RENDER_KEYS,
  INFRA_RENDER_RESOURCE_TYPES,
} from '../../domain/services/infraCostSettings';
import { AI_PROVIDER_KINDS } from '../../../assistants/domain/enums/AiProviderKind';

const num = { type: 'number' } as const;
const nullableNum = { type: ['number', 'null'] } as const;
const str = { type: 'string' } as const;
const nullableStr = { type: ['string', 'null'] } as const;
const bool = { type: 'boolean' } as const;
const int = { type: 'integer' } as const;
const strEnum = (values: readonly string[]) => ({ type: 'string', enum: [...values] }) as const;
const nullableEnum = (values: readonly string[]) => ({ type: ['string', 'null'], enum: [...values, null] }) as const;

function obj(properties: Record<string, unknown>) {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties } as const;
}
function nullable<T extends { type: string }>(schema: T) {
  return { ...schema, type: [schema.type, 'null'] } as const;
}

function envelope(data: unknown) {
  return { type: 'object', additionalProperties: false, properties: { success: bool, data } } as const;
}

// ── Configuração ─────────────────────────────────────────────────────────────

const settingsSchema = obj({
  fx: obj({
    auto: bool,
    override: nullable(obj({ rate: num, date: str })),
    closingMethod: strEnum(INFRA_FX_CLOSING_METHODS),
  }),
  items: {
    type: 'array',
    items: obj({
      key: str,
      label: str,
      category: strEnum(INFRA_COST_CATEGORIES),
      billing: strEnum(INFRA_COST_BILLINGS),
      monthlyUsd: num,
      quantity: int,
      storage: nullable(obj({ gb: nullableNum, usdPerGb: nullableNum })),
      renderKey: nullableEnum(INFRA_RENDER_KEYS),
      planLabel: nullableStr,
      allocation: strEnum(INFRA_COST_ALLOCATIONS),
      note: nullableStr,
    }),
  },
  renderPlanPrices: {
    type: 'array',
    items: obj({ resourceType: strEnum(INFRA_RENDER_RESOURCE_TYPES), plan: str, monthlyUsd: num }),
  },
  aiModelPrices: {
    type: 'array',
    items: obj({ kind: strEnum(AI_PROVIDER_KINDS), model: str, inputPerMTokUsd: num, outputPerMTokUsd: num }),
  },
  workspace: obj({
    planLabel: str,
    cycleStartDay: int,
    includedBandwidthGb: num,
    includedBuildMinutes: int,
    bandwidthUsdPerGb: num,
    buildUsdPer1000Min: num,
    manualBandwidthGb: nullableNum,
    manualBuildMinutes: { type: ['integer', 'null'] },
  }),
});

export const infraCostSettingsResponse = envelope(
  obj({
    settings: settingsSchema,
    origin: strEnum(['default', 'saved']),
    updatedAt: { type: ['string', 'null'], format: 'date-time' },
  }),
);

/**
 * `PUT /admin/costs/settings`. `settings` só exige ser objeto: faixa, tipo e campo desconhecido são
 * do domínio (`parseInfraCostSettings`), que devolve 400 `INVALID_INFRA_COST_SETTINGS` com `meta.field`.
 */
export const infraCostSettingsBody = {
  type: 'object',
  additionalProperties: false,
  required: ['settings', 'expectedUpdatedAt'],
  properties: {
    settings: { type: 'object' },
    expectedUpdatedAt: { type: ['string', 'null'] },
  },
} as const;

// ── Resumo ───────────────────────────────────────────────────────────────────

export const infraCostSummaryQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' } },
} as const;

const money = obj({ usd: num, brl: nullableNum });
const nullableMoney = nullable(money);
const neighbor = nullable(obj({ plan: str, monthly: money, diff: money }));
const usage = obj({
  included: num,
  consumed: nullableNum,
  source: nullableEnum(['manual', 'measured']),
  overage: num,
  cost: money,
});

const summarySchema = obj({
  month: str,
  basis: strEnum(['snapshot', 'hours']),
  generatedAt: { type: 'string', format: 'date-time' },
  fx: nullable(
    obj({
      rate: num,
      referenceDate: str,
      source: strEnum(['override', 'ptax', 'sgs', 'last_known']),
      fetchedAt: { type: ['string', 'null'], format: 'date-time' },
      stale: bool,
    }),
  ),
  sessionsSampledAt: { type: ['string', 'null'], format: 'date-time' },
  totalIsPartial: bool,
  totals: obj({ total: money, fixed: money, variable: money, shared: money, projected: nullableMoney }),
  items: {
    type: 'array',
    items: obj({
      key: str,
      label: str,
      category: strEnum(INFRA_COST_CATEGORIES),
      billing: strEnum(INFRA_COST_BILLINGS),
      renderKey: nullableEnum(INFRA_RENDER_KEYS),
      planLabel: str,
      plan: nullableStr,
      quantity: num,
      quantitySource: strEnum(['manual', 'measured_now', 'measured_hours']),
      allocation: strEnum(INFRA_COST_ALLOCATIONS),
      compute: nullableMoney,
      storage: nullableMoney,
      storageToConfirm: bool,
      cost: nullableMoney,
      estimated: bool,
      neighbors: nullable(obj({ lower: neighbor, upper: neighbor })),
    }),
  },
  workspace: obj({ planLabel: str, bandwidth: usage, build: usage, total: money }),
  perSession: obj({
    contracted: obj({ sessions: num, perSession: nullableMoney, unlimitedTenants: int }),
    connected: obj({
      sessions: num,
      perSession: nullableMoney,
      unallocatedSessions: nullableNum,
      unallocatedCost: nullableMoney,
    }),
  }),
  marginalPerSession: nullableMoney,
  plans: {
    type: 'array',
    items: obj({
      planSlug: nullableStr,
      tenants: int,
      contractedSessions: num,
      connectedSessions: num,
      share: nullableMoney,
      costPerTenant: nullableMoney,
      connectedShare: nullableMoney,
      connectedCostPerTenant: nullableMoney,
    }),
  },
  warnings: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['code'],
      properties: {
        code: strEnum([
          'config_drift',
          'fx_fallback',
          'fx_missing',
          'ai_tokens_missing',
          'plan_without_price',
          'model_without_price',
          'missing_hours',
          'storage_to_confirm',
          'unlimited_contracted',
          'sessions_sample_stale',
        ]),
        resourceKey: str,
        key: str,
        plan: str,
        field: str,
        model: str,
        count: int,
      },
    },
  },
});

export const infraCostSummaryResponse = envelope(summarySchema);
