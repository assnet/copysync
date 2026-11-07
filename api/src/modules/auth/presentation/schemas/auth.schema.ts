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
    turnstileToken: { type: 'string', maxLength: 4096 },
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

/** Passo do código por e-mail (docs/seguranca-login.md). */
export const loginVerifyBodySchema = {
  type: 'object',
  required: ['ticket', 'code'],
  properties: {
    ticket: { type: 'string', minLength: 1, maxLength: 1024 },
    code: { type: 'string', pattern: '^[0-9]{6}$' },
  },
  additionalProperties: false,
} as const;

export const loginResendBodySchema = {
  type: 'object',
  required: ['ticket'],
  properties: {
    ticket: { type: 'string', minLength: 1, maxLength: 1024 },
  },
  additionalProperties: false,
} as const;

export const loginCodeChallengeResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['OTP_REQUIRED'] },
        ticket: { type: 'string' },
        codeSent: { type: 'boolean' },
        codeExpiresAt: { type: ['string', 'null'] },
        resendAvailableAt: { type: 'string' },
      },
    },
  },
} as const;
