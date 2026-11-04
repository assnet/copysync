/** Schemas de resposta compartilhados (`$ref`), registrados em `app.ts`. */
export const sessionStatusSchema = {
  $id: 'SessionStatus',
  type: 'string',
  enum: ['PENDING', 'CONNECTING', 'AWAITING_QR', 'AWAITING_PAIRING', 'AWAITING_CODE', 'AWAITING_PASSWORD', 'CONNECTED', 'DISCONNECTED', 'LOGGED_OUT', 'FAILED'],
} as const;

export const sessionItemSchema = {
  $id: 'SessionItem',
  type: 'object',
  properties: {
    id: { type: 'string' },
    tenantId: { type: 'string' },
    name: { type: 'string' },
    engine: { type: 'string' },
    phone: { type: 'string', nullable: true },
    declaredPhone: { type: 'string', nullable: true },
    phoneMismatch: { type: 'boolean' },
    externalRef: { type: 'string', nullable: true },
    status: { $ref: 'SessionStatus#' },
    // Pedido vivo sem lease vivo (adoção por capacidade); false com a flag desligada.
    awaitingCapacity: { type: 'boolean' },
    lastConnectedAt: { type: 'string', format: 'date-time', nullable: true },
    lastDisconnectedAt: { type: 'string', format: 'date-time', nullable: true },
    lastSeenAt: { type: 'string', format: 'date-time', nullable: true },
    // Foto do número conectado. Sem declarar aqui, o serializer do Fastify
    // descarta o campo silenciosamente, mesmo o presenter devolvendo-o.
    avatarUrl: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;
