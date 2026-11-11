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

/** Evento de escala sem ator nem `requestId` (WSCALE-13; quem pediu fica na auditoria). */
const scaleEvent = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'at', 'trigger', 'fromReplicas', 'toReplicas', 'reason', 'outcome', 'error'],
  properties: {
    id: { type: 'integer' },
    at: { type: 'string', format: 'date-time' },
    trigger: { type: 'string', enum: ['manual', 'auto'] },
    fromReplicas: { type: 'integer' },
    toReplicas: { type: 'integer' },
    reason: { type: 'string' },
    outcome: { type: 'string', enum: ['requested', 'succeeded', 'failed', 'rejected'] },
    error: { type: ['string', 'null'] },
  },
} as const;

/**
 * Estado do escalador (`IWorkerScaler`): `ready` com réplicas e bloqueios; `not_configured` com os
 * NOMES das envs ausentes; `unavailable` com o motivo. Nunca chave nem id do serviço.
 */
const scalerState = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['ready', 'not_configured', 'unavailable'] },
    desiredReplicas: { type: 'integer' },
    runningReplicas: { type: 'integer' },
    hasDisk: { type: 'boolean' },
    autoscalingEnabled: { type: 'boolean' },
    missing: {
      type: 'array',
      items: { type: 'string', enum: ['WORKER_SCALER_ENABLED', 'RENDER_API_KEY', 'WORKER_SCALER_SERVICE_ID'] },
    },
    reason: { type: 'string', enum: ['auth', 'not_found', 'rate_limited', 'upstream', 'timeout'] },
  },
} as const;

/** `GET /admin/workers/scale` (WSCALE-14): estado (cache 30 s), faixa, intervalo mínimo e último evento. */
export const workerScaleStateResponse = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      additionalProperties: false,
      required: ['scaler', 'settings', 'cooldownUntil', 'lastEvent', 'enforced'],
      properties: {
        scaler: scalerState,
        settings: {
          type: 'object',
          additionalProperties: false,
          required: ['scalerMode', 'minReplicas', 'maxReplicas', 'scaleCooldownSeconds'],
          properties: {
            scalerMode: { type: 'string', enum: ['off', 'manual', 'auto'] },
            minReplicas: { type: 'integer' },
            maxReplicas: { type: 'integer' },
            scaleCooldownSeconds: { type: 'integer' },
          },
        },
        cooldownUntil: { type: ['string', 'null'], format: 'date-time' },
        lastEvent: { anyOf: [scaleEvent, { type: 'null' }] },
        enforced: { type: 'boolean' },
      },
    },
  },
} as const;

/** `POST /admin/workers/scale` (WSCALE-12). Faixa `[min, max]` é do use case (400 com `meta.field`). */
export const workerScaleRequestBody = {
  type: 'object',
  additionalProperties: false,
  required: ['replicas', 'reason', 'requestId'],
  properties: {
    replicas: { type: 'integer' },
    reason: { type: 'string', minLength: 3, maxLength: 200, pattern: '\\S' },
    requestId: { type: 'string', format: 'uuid' },
  },
} as const;

/** Resposta do pedido: o evento e se foi repetição do mesmo `requestId` (nada chamado de novo). */
export const workerScaleRequestResponse = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      additionalProperties: false,
      required: ['event', 'replayed'],
      properties: { event: scaleEvent, replayed: { type: 'boolean' } },
    },
  },
} as const;

/** `GET /admin/workers/scale/events?cursor=`: página de tamanho fixo no servidor, cursor assinado. */
export const workerScaleEventsQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { cursor: { type: 'string', maxLength: 512 } },
} as const;

export const workerScaleEventsResponse = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'nextCursor'],
      properties: {
        items: { type: 'array', items: scaleEvent },
        nextCursor: { type: ['string', 'null'] },
      },
    },
  },
} as const;
