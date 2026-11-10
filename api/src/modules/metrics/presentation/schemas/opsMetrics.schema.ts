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

const worker = {
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
        workers: { type: 'array', items: worker },
      },
    },
  },
} as const;
