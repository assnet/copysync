// ── Params ────────────────────────────────────────────────────────────────────

/**
 * Só o formato que o store gera (`randomUUID`: v4, minúsculo). Fora disso a rota responde 400
 * antes de qualquer acesso ao disco — o store também recusa, mas como inexistente.
 */
const UPLOAD_ID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

const uploadId = { type: 'string', pattern: UPLOAD_ID_PATTERN } as const;

export const uploadIdParamSchema = {
  type: 'object',
  required: ['uploadId'],
  properties: { uploadId },
  additionalProperties: false,
} as const;

export const uploadPartParamSchema = {
  type: 'object',
  required: ['uploadId', 'index'],
  properties: {
    uploadId,
    index: { type: 'integer', minimum: 0 },
  },
  additionalProperties: false,
} as const;

// ── Bodies ────────────────────────────────────────────────────────────────────

/** O limite por finalidade (413) e o nome sanitizado ficam no use case, fonte única. */
export const createUploadBodySchema = {
  type: 'object',
  required: ['fileName', 'sizeBytes', 'purpose'],
  properties: {
    fileName:         { type: 'string', minLength: 1, maxLength: 255 },
    sizeBytes:        { type: 'integer', minimum: 1 },
    purpose:          { type: 'string', enum: ['media', 'document', 'voice'] },
    declaredMimeType: { type: ['string', 'null'], maxLength: 255 },
  },
  additionalProperties: false,
} as const;
