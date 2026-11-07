const worker = {
  type: 'object',
  additionalProperties: false,
  required: ['workerId', 'role', 'sessions', 'pendingLogins', 'maxSessions', 'rssMb', 'seenAt'],
  properties: {
    workerId: { type: 'string' },
    role: { type: 'string' },
    sessions: { type: 'integer' },
    pendingLogins: { type: 'integer' },
    maxSessions: { type: 'integer' },
    rssMb: { type: 'integer' },
    seenAt: { type: 'string', format: 'date-time' },
  },
} as const;

const totals = {
  type: 'object',
  additionalProperties: false,
  required: ['workers', 'sessions', 'pendingLogins', 'maxSessions'],
  properties: {
    workers: { type: 'integer' },
    sessions: { type: 'integer' },
    pendingLogins: { type: 'integer' },
    maxSessions: { type: 'integer' },
  },
} as const;

/** Processo dono de lease vivo (adoção desligada): sem teto nem heartbeat. */
const leaseProcess = {
  type: 'object',
  additionalProperties: false,
  required: ['workerId', 'sessions', 'leaseUntil'],
  properties: {
    workerId: { type: 'string' },
    sessions: { type: 'integer' },
    leaseUntil: { type: 'string', format: 'date-time' },
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
      required: ['adoptionEnabled', 'workers', 'totals', 'awaiting', 'processes', 'leasedSessions'],
      properties: {
        adoptionEnabled: { type: 'boolean' },
        workers: { type: 'array', items: worker },
        totals,
        awaiting: { type: 'integer' },
        processes: { type: 'array', items: leaseProcess },
        leasedSessions: { type: 'integer' },
      },
    },
  },
} as const;
