// ── Params ────────────────────────────────────────────────────────────────────

export const conversationIdParamSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1 },
  },
} as const;

export const messageIdParamSchema = {
  type: 'object',
  required: ['messageId'],
  properties: {
    messageId: { type: 'string', minLength: 1 },
  },
} as const;

/**
 * `emoji` obrigatório: corpo vazio é erro, não remoção implícita. `null` remove.
 * maxLength é só barreira grosseira (em code points); a regra real (≤ 64 bytes, não só ASCII,
 * sem whitespace/controle) fica no use case, fonte única.
 */
export const reactionBodySchema = {
  type: 'object',
  required: ['emoji'],
  properties: {
    emoji: { type: ['string', 'null'], maxLength: 32 },
  },
  additionalProperties: false,
} as const;

export const contactIdParamSchema = {
  type: 'object',
  required: ['contactId'],
  properties: {
    contactId: { type: 'string', minLength: 1 },
  },
} as const;

// ── Query strings ─────────────────────────────────────────────────────────────

export const listConversationsQuerySchema = {
  type: 'object',
  properties: {
    search:     { type: 'string' },
    status:     { type: 'string' },
    sessionId:  { type: 'string' },
    unreadOnly: { type: 'string' },
    archived:   { type: 'string' },
    isGroup:    { type: 'string', enum: ['true', 'false'] },
  },
} as const;

export const listMessagesQuerySchema = {
  type: 'object',
  properties: {
    search: { type: 'string' },
    around: { type: 'string' },
    limit:  { type: 'string' },
    before: { type: 'string' },
  },
} as const;

// ── Bodies ────────────────────────────────────────────────────────────────────

export const sendMessageBodySchema = {
  type: 'object',
  required: ['content'],
  properties: {
    content:         { type: 'string', minLength: 1, maxLength: 4096 },
    quotedMessageId: { type: 'string' },
    mentions: {
      type: 'array',
      items: { type: 'string', pattern: '^[0-9]{5,20}$' },
      maxItems: 50,
    },
  },
  additionalProperties: false,
} as const;

/**
 * Confirma um upload como mensagem. `uploadId` só no formato que o store gera (`randomUUID`: v4,
 * minúsculo — mesmo padrão de `media.upload.schema.ts`); fora disso, 400 antes de tocar o disco.
 * Legenda com o mesmo limite do texto.
 */
export const sendMediaMessageBodySchema = {
  type: 'object',
  required: ['uploadId'],
  properties: {
    uploadId:        { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' },
    caption:         { type: 'string', maxLength: 4096 },
    quotedMessageId: { type: 'string' },
  },
  additionalProperties: false,
} as const;

export const updateConversationBodySchema = {
  type: 'object',
  properties: {
    status:            { type: 'string' },
    assignedUserId:    { type: ['string', 'null'] },
    queueName:         { type: ['string', 'null'] },
    tags:              { type: 'array', items: { type: 'string' } },
    notes:             { type: ['string', 'null'] },
    autoDownloadMedia: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

export const startConversationBodySchema = {
  type: 'object',
  required: ['sessionId', 'phone'],
  properties: {
    sessionId: { type: 'string', minLength: 1 },
    phone:     { type: 'string', minLength: 8 },
    name:      { type: 'string' },
  },
} as const;

export const suggestContactsQuerySchema = {
  type: 'object',
  required: ['q'],
  properties: {
    q:         { type: 'string' },
    sessionId: { type: 'string' },
  },
} as const;

export const conversationStateBodySchema = {
  type: 'object',
  properties: {
    archived: { type: 'boolean' },
    pinned:   { type: 'boolean' },
    // null remove o silêncio; número é a duração em milissegundos.
    muteMs:   { type: ['number', 'null'] },
    favorite: { type: 'boolean' },
    unread:   { type: 'boolean' },
    lists:    { type: 'array', items: { type: 'string' } },
  },
} as const;

export const listParticipantsQuerySchema = {
  type: 'object',
  // Sem limit/offset: o tamanho da página é do servidor e a posição vem no cursor
  // assinado, para o cliente não conseguir pedir a lista inteira.
  properties: {
    cursor: { type: 'string' },
    search: { type: 'string' },
  },
} as const;

// ── Listas (catálogo) ─────────────────────────────────────────────────────────
// maxLength é barreira grosseira; o aparo e a regra final (1..40 após trim) ficam no use case.

export const listIdParamSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const listNameParamSchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 40 },
  },
  additionalProperties: false,
} as const;

export const listNameBodySchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 40 },
  },
  additionalProperties: false,
} as const;

export const renameListByNameBodySchema = {
  type: 'object',
  required: ['name', 'newName'],
  properties: {
    name:    { type: 'string', minLength: 1, maxLength: 40 },
    newName: { type: 'string', minLength: 1, maxLength: 40 },
  },
  additionalProperties: false,
} as const;
