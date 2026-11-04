export const createSessionBodySchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    engine: { type: 'string', enum: ['baileys', 'telegram'] },
    // Formato validado no use case (422 SESSION_PHONE_INVALID com meta.field).
    declaredPhone: { type: 'string', maxLength: 32 },
  },
  additionalProperties: false,
} as const;

export const sessionIdParamSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1 },
  },
} as const;

// Corpo opcional: `null` deixa a requisição sem corpo passar (sem ele o Fastify exige objeto).
// Com `content-type: application/json` o painel deve mandar `{}`, nunca corpo vazio.
export const requestPairingCodeBodySchema = {
  type: ['object', 'null'],
  properties: {
    // Opcional: sem ele, usa o número declarado na criação da sessão.
    phone: { type: 'string', maxLength: 32 },
  },
  additionalProperties: false,
} as const;

// Telegram: telefone opcional (sem ele vale o declarado na criação). `null` = sem corpo.
export const loginCodeRequestBodySchema = {
  type: ['object', 'null'],
  properties: {
    phone: { type: 'string', maxLength: 32 },
  },
  additionalProperties: false,
} as const;

export const loginCodeSubmitBodySchema = {
  type: 'object',
  required: ['code'],
  properties: {
    code: { type: 'string', minLength: 3, maxLength: 12 },
  },
  additionalProperties: false,
} as const;

export const loginPasswordSubmitBodySchema = {
  type: 'object',
  required: ['password'],
  properties: {
    password: { type: 'string', minLength: 1, maxLength: 256 },
  },
  additionalProperties: false,
} as const;
