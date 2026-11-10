/** `GET /admin/ops/metrics` (MQ-25). Sem `limit`/`offset`: a página é do servidor, o cliente só devolve o cursor. */
export const opsMetricsQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    metric: { type: 'string', pattern: '^[a-z0-9_]{1,64}$' },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    cursor: { type: 'string', minLength: 1, maxLength: 1024 },
  },
} as const;

const sample = {
  type: 'object',
  additionalProperties: false,
  required: ['at', 'source', 'resource', 'metric', 'value', 'meta'],
  properties: {
    at: { type: 'string', format: 'date-time' },
    source: { type: 'string' },
    resource: { type: 'string' },
    metric: { type: 'string' },
    value: { type: 'number' },
    meta: { type: ['object', 'null'], additionalProperties: { type: ['string', 'number', 'null'] } },
  },
} as const;

export const opsWorker = {
  type: 'object',
  additionalProperties: false,
  required: ['workerId', 'role', 'sessions', 'pendingLogins', 'maxSessions', 'rssMb', 'cpuPct', 'eventLoopP99Ms', 'seenAt'],
  properties: {
    workerId: { type: 'string' },
    role: { type: 'string' },
    sessions: { type: 'integer' },
    pendingLogins: { type: 'integer' },
    maxSessions: { type: 'integer' },
    rssMb: { type: 'integer' },
    cpuPct: { type: ['number', 'null'] },
    eventLoopP99Ms: { type: ['number', 'null'] },
    seenAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const opsMetricsResponse = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      additionalProperties: false,
      required: ['window', 'samples', 'nextCursor', 'workers'],
      properties: {
        window: {
          type: 'object',
          additionalProperties: false,
          required: ['from', 'to'],
          properties: { from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' } },
        },
        samples: { type: 'array', items: sample },
        nextCursor: { type: ['string', 'null'] },
        workers: { type: 'array', items: opsWorker },
      },
    },
  },
} as const;

const isoDate = { type: 'string', format: 'date-time' } as const;
const opsWindow = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'to'],
  properties: { from: isoDate, to: isoDate },
} as const;
const kind = { type: 'string', enum: ['api', 'postgres', 'worker', 'query', 'other'] } as const;

/** `GET /admin/ops/metrics/series`: `metrics` separado por vírgula (nomes validados no use case). */
export const opsMetricsSeriesQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    metrics: { type: 'string', pattern: '^[a-z0-9_]{1,64}(,[a-z0-9_]{1,64})*$', maxLength: 800 },
    from: isoDate,
    to: isoDate,
    resource: { type: 'string', pattern: '^[^\\s,]{1,200}$' },
  },
} as const;

/**
 * Até 40 séries (`OPS_SERIES_MAX_SERIES`); `db_statement_total_ms` sem `resource` = top 10 `queryid`
 * por `max(value)` na janela. Gauge: min/max = picos de `meta`; counter: de `value`.
 */
export const opsMetricsSeriesResponse = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      additionalProperties: false,
      required: ['window', 'bucketMinutes', 'series'],
      properties: {
        window: opsWindow,
        bucketMinutes: { type: 'integer' },
        series: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['resource', 'kind', 'metric', 'points'],
            properties: {
              resource: { type: 'string' },
              kind,
              metric: { type: 'string' },
              points: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['at', 'avg', 'min', 'max'],
                  properties: { at: isoDate, avg: { type: 'number' }, min: { type: 'number' }, max: { type: 'number' } },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const opsMetricsLatestResponse = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      additionalProperties: false,
      required: ['latest', 'thresholds', 'topQueries', 'samplerActive', 'workers'],
      properties: {
        latest: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['resource', 'kind', 'metric', 'value', 'at'],
            properties: { resource: { type: 'string' }, kind, metric: { type: 'string' }, value: { type: 'number' }, at: isoDate },
          },
        },
        thresholds: {
          type: 'object',
          additionalProperties: false,
          required: ['memoryPct', 'cpuPct', 'idleInTransaction', 'eventLoopP99Ms'],
          properties: {
            memoryPct: { type: 'number' },
            cpuPct: { type: 'number' },
            idleInTransaction: { type: 'number' },
            eventLoopP99Ms: { type: 'number' },
          },
        },
        topQueries: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['queryid', 'shape', 'totalMs', 'meanMs', 'calls', 'at'],
            properties: {
              queryid: { type: 'string' },
              shape: { type: ['string', 'null'] },
              totalMs: { type: 'number' },
              meanMs: { type: ['number', 'null'] },
              calls: { type: ['number', 'null'] },
              at: isoDate,
            },
          },
        },
        samplerActive: { type: 'boolean' },
        workers: { type: 'array', items: opsWorker },
      },
    },
  },
} as const;
