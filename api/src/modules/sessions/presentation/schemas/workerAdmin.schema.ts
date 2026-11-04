const worker = {
  type: 'object',
  additionalProperties: false,
  required: ['workerId', 'role', 'sessions', 'maxSessions', 'rssMb', 'seenAt'],
  properties: {
    workerId: { type: 'string' },
    role: { type: 'string' },
    sessions: { type: 'integer' },
    maxSessions: { type: 'integer' },
    rssMb: { type: 'integer' },
    seenAt: { type: 'string', format: 'date-time' },
  },
} as const;

const totals = {
  type: 'object',
  additionalProperties: false,
  required: ['workers', 'sessions', 'maxSessions'],
  properties: {
    workers: { type: 'integer' },
    sessions: { type: 'integer' },
    maxSessions: { type: 'integer' },
  },
} as const;

/** `GET /admin/workers`: workers vivos, totais e sessões aguardando capacidade (ADOPT-12). */
export const workerListResponse = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      additionalProperties: false,
      required: ['workers', 'totals', 'awaiting'],
      properties: { workers: { type: 'array', items: worker }, totals, awaiting: { type: 'integer' } },
    },
  },
} as const;
