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

const scalingSettings = {
  type: 'object',
  additionalProperties: false,
  required: [
    'maxSessionsPerWorker', 'maxPendingLoginsPerWorker', 'alertOccupancyRatio', 'awaitingAlertSeconds',
    'scalerMode', 'minReplicas', 'maxReplicas', 'scaleUpSustainSeconds', 'scaleCooldownSeconds',
  ],
  properties: {
    maxSessionsPerWorker: { type: 'integer' },
    maxPendingLoginsPerWorker: { type: 'integer' },
    alertOccupancyRatio: { type: 'number' },
    awaitingAlertSeconds: { type: 'integer' },
    scalerMode: { type: 'string', enum: ['off', 'manual', 'auto'] },
    minReplicas: { type: 'integer' },
    maxReplicas: { type: 'integer' },
    scaleUpSustainSeconds: { type: 'integer' },
    scaleCooldownSeconds: { type: 'integer' },
  },
} as const;

const source = { type: 'string', enum: ['default', 'saved'] } as const;

/** `GET`/`PUT /admin/workers/settings`: valor efetivo, origem por campo, `updatedAt` e se tem efeito (WSCALE-06). */
export const workerScalingSettingsResponse = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      additionalProperties: false,
      required: ['settings', 'origin', 'updatedAt', 'enforced'],
      properties: {
        settings: scalingSettings,
        origin: {
          type: 'object',
          additionalProperties: false,
          required: scalingSettings.required,
          properties: Object.fromEntries(scalingSettings.required.map((k) => [k, source])),
        },
        updatedAt: { type: ['string', 'null'], format: 'date-time' },
        enforced: { type: 'boolean' },
      },
    },
  },
} as const;

/**
 * `PUT /admin/workers/settings`. `settings` só exige ser objeto: faixa, tipo e campo desconhecido
 * são do domínio, que devolve 400 com `meta.field`.
 */
export const workerScalingSettingsBody = {
  type: 'object',
  additionalProperties: false,
  required: ['settings', 'expectedUpdatedAt'],
  properties: {
    settings: { type: 'object' },
    expectedUpdatedAt: { type: ['string', 'null'] },
  },
} as const;

const capacityChannel = {
  type: 'object',
  additionalProperties: false,
  required: ['contracted', 'unlimitedTenants', 'created', 'connected'],
  properties: {
    contracted: { type: 'number' },
    unlimitedTenants: { type: 'integer' },
    created: { type: 'integer' },
    connected: { type: 'integer' },
  },
} as const;

const nullableNumber = { type: ['number', 'null'] } as const;

/**
 * `GET /admin/workers/capacity` (WSCALE-09), tipo `WorkerCapacityView` de `GetWorkerCapacityUseCase.ts`:
 * `{ plans: [{ planSlug, tenants, whatsapp, telegram }], cluster: { capacity, connected, occupancyPct,
 * headroom, requiredReplicas, mbPerSession, suggestedMaxSessions, memoryLimitMb, sampledAt, stale },
 * settings: { maxSessionsPerWorker, alertOccupancyRatio }, enforced }`. Canal = `{ contracted,
 * unlimitedTenants, created, connected }`. `cluster.connected`/`capacity` = última amostra `sessions_*`
 * da última hora (0 e `sampledAt: null` sem amostra); `stale` = amostra com mais de 10 min (números
 * mantidos, não atuais); `null` em memória = "sem amostra". Conectadas: cluster = todas as sessões com
 * lease vivo (inclui tenant suspenso); planos = só tenants ativos — a soma dos planos pode ser menor.
 */
export const workerCapacityResponse = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      additionalProperties: false,
      required: ['plans', 'cluster', 'settings', 'enforced'],
      properties: {
        plans: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['planSlug', 'tenants', 'whatsapp', 'telegram'],
            properties: {
              planSlug: { type: ['string', 'null'] },
              tenants: { type: 'integer' },
              whatsapp: capacityChannel,
              telegram: capacityChannel,
            },
          },
        },
        cluster: {
          type: 'object',
          additionalProperties: false,
          required: [
            'capacity', 'connected', 'occupancyPct', 'headroom', 'requiredReplicas',
            'mbPerSession', 'suggestedMaxSessions', 'memoryLimitMb', 'sampledAt', 'stale',
          ],
          properties: {
            capacity: { type: 'integer' },
            connected: { type: 'integer' },
            occupancyPct: { type: 'number' },
            headroom: { type: 'integer' },
            requiredReplicas: { type: 'integer' },
            mbPerSession: nullableNumber,
            suggestedMaxSessions: { type: ['integer', 'null'] },
            memoryLimitMb: nullableNumber,
            sampledAt: { type: ['string', 'null'], format: 'date-time' },
            stale: { type: 'boolean' },
          },
        },
        settings: {
          type: 'object',
          additionalProperties: false,
          required: ['maxSessionsPerWorker', 'alertOccupancyRatio'],
          properties: {
            maxSessionsPerWorker: { type: 'integer' },
            alertOccupancyRatio: { type: 'number' },
          },
        },
        enforced: { type: 'boolean' },
      },
    },
  },
} as const;
