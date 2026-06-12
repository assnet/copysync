export const changePasswordBodySchema = {
  type: 'object',
  required: ['newPassword', 'confirmPassword'],
  properties: {
    newPassword: { type: 'string', minLength: 1 },
    confirmPassword: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const;
