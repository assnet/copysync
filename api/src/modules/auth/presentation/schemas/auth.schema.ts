/**
 * JSON Schema definitions for auth route validation.
 * Fastify uses these for request body parsing and type coercion.
 */

export const loginBodySchema = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const refreshBodySchema = {
  type: 'object',
  required: ['refreshToken'],
  properties: {
    refreshToken: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const logoutBodySchema = {
  type: 'object',
  required: ['refreshToken'],
  properties: {
    refreshToken: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const;
