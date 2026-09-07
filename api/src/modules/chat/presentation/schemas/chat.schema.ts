// ── Params ────────────────────────────────────────────────────────────────────

export const conversationIdParamSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1 },
  },
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
  properties: {
    limit:  { type: 'string' },
    offset: { type: 'string' },
    search: { type: 'string' },
  },
} as const;
