import {
  LinkRotationGroupLinkSource,
  LinkRotationGroupStatus,
  LinkRotationStatus,
  LinkRotationStrategy,
} from '../../domain/enums/LinkRotationEnums';

/*
 * Schemas fechados (`additionalProperties: false`) na entrada e na saída. Forma fina do nome
 * (3–50, a-z0-9-), faixas de peso/teto e link manual são validadas no use case (códigos
 * LINK_SLUG_INVALID, LINK_GROUP_INVALID, LINK_INVITE_URL_INVALID); aqui só tipo e teto.
 */
const id = { type: 'string', minLength: 1, maxLength: 64 } as const;
const slug = { type: 'string', minLength: 1, maxLength: 63 } as const;
const title = { type: ['string', 'null'], maxLength: 80 } as const;
const strategy = { type: 'string', enum: Object.values(LinkRotationStrategy) } as const;
const nullableDate = { type: ['string', 'null'], format: 'date-time' } as const;
const date = { type: 'string', format: 'date-time' } as const;
const groupStatus = { type: 'string', enum: Object.values(LinkRotationGroupStatus) } as const;

const envelope = (data: object) => ({
  type: 'object',
  additionalProperties: false,
  properties: { success: { type: 'boolean' }, data },
});

// ── Params / query ───────────────────────────────────────────────────────────

export const rotationIdParamSchema = {
  type: 'object',
  required: ['id'],
  properties: { id },
} as const;

export const rotationGroupParamSchema = {
  type: 'object',
  required: ['id', 'gid'],
  properties: { id, gid: id },
} as const;

export const groupCandidatesQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { search: { type: 'string', maxLength: 80 } },
} as const;

// ── Corpo ────────────────────────────────────────────────────────────────────

export const createRotationBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sessionId', 'domainId', 'slug'],
  properties: { sessionId: id, domainId: id, slug, strategy, title },
} as const;

export const updateRotationBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    /** PAUSED_BY_PLAN é do sistema. */
    status: { type: 'string', enum: [LinkRotationStatus.ACTIVE, LinkRotationStatus.PAUSED] },
    strategy,
    title,
    sessionId: id,
  },
} as const;

export const renameRotationBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['slug'],
  properties: { slug, domainId: id },
} as const;

export const saveGroupsBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['groups'],
  properties: {
    groups: {
      type: 'array',
      maxItems: 500,
      items: {
        type: 'object',
        additionalProperties: false,
        anyOf: [{ required: ['conversationId'] }, { required: ['groupJid'] }],
        properties: {
          conversationId: id,
          groupJid: { type: 'string', minLength: 1, maxLength: 128 },
          position: { type: 'integer', minimum: 0 },
          weight: { type: 'integer' },
          capacity: { type: 'integer' },
          manualInviteUrl: { type: ['string', 'null'], maxLength: 300 },
        },
      },
    },
  },
} as const;

// ── Saída ────────────────────────────────────────────────────────────────────

const group = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    conversationId: { type: 'string' },
    groupJid: { type: 'string' },
    groupName: { type: ['string', 'null'] },
    position: { type: 'integer' },
    weight: { type: 'integer' },
    capacity: { type: 'integer' },
    inviteUrl: { type: ['string', 'null'] },
    linkSource: { type: ['string', 'null'], enum: [...Object.values(LinkRotationGroupLinkSource), null] },
    status: groupStatus,
    memberCount: { type: ['integer', 'null'] },
    memberCountAt: nullableDate,
    clicksSinceSync: { type: 'integer' },
    clickCount: { type: 'integer' },
    lastClickAt: nullableDate,
  },
} as const;

const rotation = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    sessionId: { type: 'string' },
    domainId: { type: 'string' },
    hostname: { type: ['string', 'null'] },
    slug: { type: 'string' },
    publicUrl: { type: ['string', 'null'] },
    status: { type: 'string', enum: Object.values(LinkRotationStatus) },
    strategy,
    title: { type: ['string', 'null'] },
    clickCount: { type: 'integer' },
    lastClickAt: nullableDate,
    allFullNotifiedAt: nullableDate,
    createdAt: date,
    updatedAt: date,
    groups: { type: 'array', items: group },
  },
} as const;

const nullableLimit = { type: ['integer', 'null'] } as const;

export const overviewResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: {
    rotations: { type: 'array', items: rotation },
    domains: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string' }, hostname: { type: 'string' } },
      },
    },
    limits: {
      type: 'object',
      additionalProperties: false,
      properties: { linkRotations: nullableLimit, linkRotationGroups: nullableLimit },
    },
    sessions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string' }, name: { type: 'string' }, status: { type: 'string' } },
      },
    },
  },
});

export const rotationResponse = envelope(rotation);

export const groupsResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: { groups: { type: 'array', items: group } },
});

export const groupResponse = envelope(group);

export const groupCandidatesResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: {
    partial: { type: 'boolean' },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          groupJid: { type: 'string' },
          title: { type: ['string', 'null'] },
          avatarUrl: { type: ['string', 'null'] },
          conversationId: { type: ['string', 'null'] },
          selected: { type: 'boolean' },
          rotationGroupId: { type: ['string', 'null'] },
          status: { type: ['string', 'null'], enum: [...Object.values(LinkRotationGroupStatus), null] },
        },
      },
    },
  },
});

export const statsResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: {
    rotationId: { type: 'string' },
    clickCount: { type: 'integer' },
    clicksLast7Days: { type: 'integer' },
    lastClickAt: nullableDate,
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          conversationId: { type: 'string' },
          groupName: { type: ['string', 'null'] },
          status: groupStatus,
          clickCount: { type: 'integer' },
          clicksLast7Days: { type: 'integer' },
          memberCount: { type: ['integer', 'null'] },
          capacity: { type: 'integer' },
        },
      },
    },
  },
});
