export const createSessionBodySchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    engine: { type: 'string', enum: ['baileys'] },
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
