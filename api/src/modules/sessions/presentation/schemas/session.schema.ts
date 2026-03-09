export const createSessionBodySchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    engine: { type: 'string', enum: ['baileys'] },
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
