/**
 * Schemas de `/admin/usage` (super admin; design §5). Espelham `contracts/feature-usage/*.response.json`.
 * `additionalProperties: false` nas respostas: nada fora do contrato sai (nome de conta só na lista de contas).
 */
import { PLAN_SLUGS, SAVER_PLAN_SLUGS } from '../../../tenants/domain/planPresets';
import type { UsageTenantStatus } from '../../domain/services/aggregateFeatureUsage';
import {
  FEATURE_USAGE_COVERAGE_REASONS,
  FEATURE_USAGE_KINDS,
  FEATURE_USAGE_PRODUCTS,
  type FeatureUsageKind,
  type FeatureUsageProduct,
} from '../../domain/services/featureUsageCatalog';
import { SCREEN_VIEW_KEYS } from '../../domain/services/screenViewCatalog';
import { DEFAULT_RECURRING_DAYS, RECURRING_DAYS_OPTIONS, type RecurringDays } from '../../domain/services/featureUsageRetention';
import { type UsageGranularity, addDays, dayInZone, daysInclusive } from '../../domain/services/featureUsagePeriod';
import type { FeatureUsageQueryInput } from '../../application/use-cases/GetFeatureUsageSummaryUseCase';

/** Teto absoluto do schema; o teto da fonte (90 dias na P1) é do use case. */
export const USAGE_SCHEMA_MAX_DAYS = 400;
/** `day` só até aqui. */
export const USAGE_DAY_GRANULARITY_MAX_DAYS = 90;
/** Sem `granularity`: `day` até aqui, `week` acima. */
export const USAGE_DAY_DEFAULT_MAX_DAYS = 31;
/** Período padrão (dias, terminando hoje em Brasília). */
export const USAGE_DEFAULT_DAYS = 30;
export const USAGE_DEFAULT_KINDS = 'ACTION,AUTOMATIC';

export const USAGE_PLAN_FILTERS = [...PLAN_SLUGS, ...SAVER_PLAN_SLUGS, 'NONE'] as const;
const GRANULARITIES = ['day', 'week', 'month'] as const;
const TENANT_STATUS_FILTERS = ['ACTIVE', 'SUSPENDED', 'CANCELLED', 'ALL'] as const;
const KIND = `(${FEATURE_USAGE_KINDS.join('|')})`;

const num = { type: 'number' } as const;
const int = { type: 'integer' } as const;
const str = { type: 'string' } as const;
const bool = { type: 'boolean' } as const;
const nullableNum = { type: ['number', 'null'] } as const;
const nullableInt = { type: ['integer', 'null'] } as const;
const nullableStr = { type: ['string', 'null'] } as const;
const strEnum = (values: readonly string[]) => ({ type: 'string', enum: [...values] }) as const;

function obj(properties: Record<string, unknown>) {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties } as const;
}
const arr = (items: unknown) => ({ type: 'array', items }) as const;
function envelope(data: unknown) {
  return { type: 'object', additionalProperties: false, properties: { success: bool, data } } as const;
}

// ── Query ────────────────────────────────────────────────────────────────────

/** Query comum (design §5). Datas e granularidade ausentes são resolvidas por `resolveUsageQuery` (dependem do relógio). */
export interface UsageQuerystring {
  from?: string;
  to?: string;
  granularity?: UsageGranularity;
  product?: FeatureUsageProduct;
  kind: string;
  plan?: string;
  tenantStatus: UsageTenantStatus | 'ALL';
  includeInternal: boolean;
  tenantId?: string;
}

const usageQueryProperties = {
  from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  granularity: strEnum(GRANULARITIES),
  product: strEnum(FEATURE_USAGE_PRODUCTS),
  /** Lista separada por vírgula, ex.: `ACTION,AUTOMATIC`. */
  kind: { type: 'string', pattern: `^${KIND}(,${KIND})*$`, default: USAGE_DEFAULT_KINDS },
  plan: strEnum(USAGE_PLAN_FILTERS),
  tenantStatus: { ...strEnum(TENANT_STATUS_FILTERS), default: 'ACTIVE' },
  includeInternal: { type: 'boolean', default: false },
  tenantId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
} as const;

export const usageQuery = { type: 'object', additionalProperties: false, properties: usageQueryProperties } as const;

/** Resumo (P3): `recurringDays` = N da recorrência, só 2, 3 ou 5 (outro valor = 400 de validação). */
export const usageSummaryQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { ...usageQueryProperties, recurringDays: { type: 'integer', enum: [...RECURRING_DAYS_OPTIONS], default: DEFAULT_RECURRING_DAYS } },
} as const;

export type UsageSummaryQuerystring = UsageQuerystring & { recurringDays?: RecurringDays };

export const usageTenantsQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { ...usageQueryProperties, cursor: { type: 'string', maxLength: 1024 } },
} as const;

export const usageFeatureParams = obj({ featureKey: { type: 'string', pattern: '^[a-z0-9_]{1,64}$' } });

/** 400 de validação no formato do Fastify (o `errorHandler` responde `HTTP_ERROR`), para regras que dependem do relógio. */
function validationError(message: string): Error {
  return Object.assign(new Error(`querystring ${message}`), { statusCode: 400, code: 'FST_ERR_VALIDATION', validation: [] });
}

/**
 * Padrões que dependem do relógio do servidor: período = últimos 30 dias terminando hoje em Brasília,
 * `granularity` = `day` até 31 dias e `week` acima. Teto absoluto de 400 dias e `day` só até 90 dias = 400 de
 * validação. `from > to`, data futura e teto da fonte ficam para o use case (`USAGE_METRICS_RANGE_INVALID`).
 */
export function resolveUsageQuery(query: UsageQuerystring, now: Date): FeatureUsageQueryInput {
  const to = query.to ?? dayInZone(now);
  const from = query.from ?? addDays(to, -(USAGE_DEFAULT_DAYS - 1));
  const days = daysInclusive(from, to);
  if (days > USAGE_SCHEMA_MAX_DAYS) throw validationError(`range must be at most ${USAGE_SCHEMA_MAX_DAYS} days`);
  const granularity = query.granularity ?? (days <= USAGE_DAY_DEFAULT_MAX_DAYS ? 'day' : 'week');
  if (granularity === 'day' && days > USAGE_DAY_GRANULARITY_MAX_DAYS) {
    throw validationError(`granularity day allows at most ${USAGE_DAY_GRANULARITY_MAX_DAYS} days`);
  }
  const requested = (query.kind ?? USAGE_DEFAULT_KINDS).split(',');
  return {
    from,
    to,
    granularity,
    product: query.product,
    kinds: FEATURE_USAGE_KINDS.filter((k): k is FeatureUsageKind => requested.includes(k)),
    plan: query.plan,
    tenantStatus: query.tenantStatus ?? 'ACTIVE',
    includeInternal: query.includeInternal ?? false,
    tenantId: query.tenantId,
  };
}

// ── Respostas ────────────────────────────────────────────────────────────────

const range = obj({
  from: str,
  to: str,
  timeZone: str,
  previousFrom: str,
  previousTo: str,
  granularity: strEnum(GRANULARITIES),
  maxDays: int,
});

const population = obj({
  tenants: int,
  internalExcluded: int,
  byPlan: arr(obj({ family: strEnum(['AFFILIATES', 'SAVER']), plan: str, tenants: int })),
});

const featureItem = obj({
  key: str,
  product: strEnum(FEATURE_USAGE_PRODUCTS),
  planFamily: strEnum(['AFFILIATES', 'SAVER']),
  kinds: arr(strEnum(FEATURE_USAGE_KINDS)),
  coverage: strEnum(['FULL', 'PARTIAL']),
  coverageReasons: arr(strEnum(FEATURE_USAGE_COVERAGE_REASONS)),
  retentionDays: nullableInt,
  firstDataDay: nullableStr,
  dataFrom: nullableStr,
  uses: int,
  usesPrevious: nullableInt,
  activeTenants: int,
  activeTenantsPrevious: nullableInt,
  reach: num,
  lastUsedDay: nullableStr,
  byKind: arr(obj({ kind: strEnum(FEATURE_USAGE_KINDS), uses: int, activeTenants: int })),
  byPlan: arr(obj({ plan: str, tenants: int, activeTenants: int, uses: int })),
  eligibleTenants: nullableInt,
  adoption: nullableNum,
  recurringTenants: nullableInt,
  retainedTenants: nullableInt,
});

const head = { range, source: strEnum(['live', 'daily']), freshAt: str, population } as const;

export const usageSummaryResponse = envelope(
  obj({
    ...head,
    totals: obj({
      activeTenants: int,
      activeTenantsPrevious: nullableInt,
      featuresUsed: int,
      featuresNeverUsed: int,
      topFeature: nullableStr,
    }),
    features: arr(featureItem),
    series: arr(obj({ bucket: str, activeTenants: int })),
  }),
);

export const usageFeatureDetailResponse = envelope(
  obj({
    ...head,
    inScope: bool,
    feature: featureItem,
    series: arr(obj({ bucket: str, uses: int, activeTenants: int })),
  }),
);

/** Do tenant só id e nome (o painel borra o nome). */
export const usageTenantsResponse = envelope(
  obj({
    items: arr(
      obj({
        tenantId: str,
        tenantName: str,
        plan: str,
        status: strEnum(['ACTIVE', 'SUSPENDED', 'CANCELLED']),
        internal: bool,
        uses: int,
        activeDays: int,
        lastUsedDay: nullableStr,
      }),
    ),
    nextCursor: nullableStr,
  }),
);

/** Telas (P3): ranking das telas por contas que abriram; sem `tenantId`. */
export const usageScreensResponse = envelope(
  obj({
    range,
    firstDataDay: nullableStr,
    population: obj({ tenants: int, byFamily: arr(obj({ family: strEnum(['AFFILIATES', 'SAVER']), tenants: int })) }),
    screens: arr(obj({ key: str, product: strEnum(FEATURE_USAGE_PRODUCTS), planFamily: strEnum(['AFFILIATES', 'SAVER']), tenants: int, tenantDays: int })),
  }),
);

/** `POST /usage/page-views` (rota da conta): só a chave da tela, da lista fechada. */
export const pageViewBody = obj({ key: strEnum(SCREEN_VIEW_KEYS) });
