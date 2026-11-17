import { SaverExportFormat, SaverExtractionItemStatus, SaverExtractionStatus, SaverExtractionTrigger } from '../../domain/enums/SaverEnums';
import { SAVER_MAX_GROUPS_PER_REQUEST } from '../../application/use-cases/RequestSaverExtractionUseCase';
import { SAVER_PREFIX_MAX } from '../../application/use-cases/ExportSavedContactsUseCase';

/*
 * Schemas fechados (`additionalProperties: false`) na entrada e na saída. Regra fina (limites do plano,
 * permissão, grupo do tenant, faixa de datas) fica nos use cases; aqui só tipo e teto.
 * Saída de tenant nunca tem nome/telefone/LID de contato; só a base da plataforma (super admin) tem.
 */
const id = { type: 'string', minLength: 1, maxLength: 64 } as const;
const jid = { type: 'string', minLength: 1, maxLength: 128 } as const;
const date = { type: 'string', format: 'date-time' } as const;
const nullableDate = { type: ['string', 'null'], format: 'date-time' } as const;
const nullableString = { type: ['string', 'null'] } as const;
const format = { type: 'string', enum: Object.values(SaverExportFormat) } as const;
const itemStatus = { type: ['string', 'null'], enum: [...Object.values(SaverExtractionItemStatus), null] } as const;
const prefix = { type: ['string', 'null'], maxLength: SAVER_PREFIX_MAX } as const;

const envelope = (data: object) => ({
  type: 'object',
  additionalProperties: false,
  properties: { success: { type: 'boolean' }, data },
});

const obj = (properties: Record<string, object>) => ({ type: 'object', additionalProperties: false, properties });

// ── Params / query / body ────────────────────────────────────────────────────

export const idParamSchema = { type: 'object', required: ['id'], additionalProperties: false, properties: { id } } as const;
export const sessionParamSchema = {
  type: 'object', required: ['sessionId'], additionalProperties: false, properties: { sessionId: id },
} as const;
export const userParamSchema = { type: 'object', required: ['userId'], additionalProperties: false, properties: { userId: id } } as const;

export const requestExtractionBodySchema = {
  type: 'object',
  required: ['sessionId', 'groupJids'],
  additionalProperties: false,
  properties: {
    sessionId: id,
    groupJids: { type: 'array', minItems: 1, maxItems: SAVER_MAX_GROUPS_PER_REQUEST, items: jid },
  },
} as const;

export const setExportGrantBodySchema = {
  type: 'object', required: ['export'], additionalProperties: false, properties: { export: { type: 'boolean' } },
} as const;

export const updateConfigBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    namePrefix: prefix,
    excludeAdminsByDefault: { type: 'boolean' },
    defaultFormat: format,
    autoRefresh: { type: 'boolean' },
  },
} as const;

export const exportBodySchema = {
  type: 'object',
  required: ['format', 'groupIds'],
  additionalProperties: false,
  properties: {
    format,
    groupIds: {
      anyOf: [
        { type: 'string', enum: ['all'] },
        { type: 'array', minItems: 1, maxItems: 1000, items: id },
      ],
    },
    options: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prefix,
        excludeAdmins: { type: 'boolean' },
        onlyWithPhone: { type: 'boolean' },
        onlyActive: { type: 'boolean' },
        onePerGroup: { type: 'boolean' },
      },
    },
  },
} as const;

/** Filtros da base da plataforma (lista e exportação). Data ISO (dia ou data e hora); validade e ordem no use case. */
const isoInput = { type: 'string', minLength: 10, maxLength: 40 } as const;
const platformFilterProps = {
  search: { type: 'string', maxLength: 100 },
  tenantId: id,
  from: isoInput,
  to: isoInput,
  ddi: { type: 'string', pattern: '^[0-9]{1,3}$' },
  ddd: { type: 'string', pattern: '^[0-9]{2}$' },
} as const;

export const platformListQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { ...platformFilterProps, cursor: { type: 'string', maxLength: 1024 } },
} as const;

/** Indicadores: mesmos filtros da lista, sem cursor. */
export const platformSummaryQuerySchema = { type: 'object', additionalProperties: false, properties: platformFilterProps } as const;

export const platformTenantsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { cursor: { type: 'string', maxLength: 1024 } },
} as const;

export const platformExportBodySchema = { type: 'object', additionalProperties: false, properties: platformFilterProps } as const;

// ── Respostas ────────────────────────────────────────────────────────────────

const usage = obj({ used: { type: 'integer' }, limit: { type: ['integer', 'null'] }, remaining: { type: ['integer', 'null'] } });
const permissions = obj({
  view: { type: 'boolean' }, extract: { type: 'boolean' }, export: { type: 'boolean' }, configure: { type: 'boolean' },
});
const overviewConfig = obj({
  namePrefix: nullableString, excludeAdminsByDefault: { type: 'boolean' }, defaultFormat: format, autoRefresh: { type: 'boolean' },
});

export const accessResponse = envelope(obj({ visible: { type: 'boolean' } }));

export const overviewResponse = envelope(obj({
  groups: usage,
  contacts: usage,
  groupScansPerDay: usage,
  autoRefreshEnabled: { type: 'boolean' },
  permissions,
  config: overviewConfig,
  queueRunning: { type: 'boolean' },
  pilot: { type: 'boolean' },
}));

export const sessionGroupsResponse = envelope({
  type: 'array',
  items: obj({
    groupJid: { type: 'string' },
    name: nullableString,
    saved: { type: 'boolean' },
    savedGroupId: nullableString,
    lastScannedAt: nullableDate,
    lastScanStatus: itemStatus,
    memberCount: { type: ['integer', 'null'] },
    kind: { type: 'string', enum: ['GROUP', 'COMMUNITY', 'COMMUNITY_ANNOUNCE'] },
    selfIsAdmin: { type: ['boolean', 'null'] },
    selectable: { type: 'boolean' },
    unselectableReason: { type: ['string', 'null'], enum: ['COMMUNITY_PARENT', null] },
  }),
});

const extraction = obj({
  id: { type: 'string' },
  sessionId: nullableString,
  trigger: { type: 'string', enum: Object.values(SaverExtractionTrigger) },
  status: { type: 'string', enum: Object.values(SaverExtractionStatus) },
  totalGroups: { type: 'integer' },
  doneGroups: { type: 'integer' },
  failedGroups: { type: 'integer' },
  membersFound: { type: 'integer' },
  newContacts: { type: 'integer' },
  createdAt: date,
  finishedAt: nullableDate,
});

export const extractionResponse = envelope(extraction);
export const cancelExtractionResponse = envelope(obj({ extraction, cancelledItems: { type: 'integer' } }));

export const groupsResponse = envelope({
  type: 'array',
  items: obj({
    id: { type: 'string' },
    groupJid: { type: 'string' },
    name: { type: 'string' },
    sessionId: nullableString,
    memberCount: { type: 'integer' },
    phoneCount: { type: 'integer' },
    lidOnlyCount: { type: 'integer' },
    lastScannedAt: nullableDate,
    lastScanStatus: itemStatus,
    createdAt: date,
  }),
});

export const grantsResponse = envelope({
  type: 'array',
  items: obj({ userId: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, canExport: { type: 'boolean' } }),
});
export const grantResponse = envelope(obj({ userId: { type: 'string' }, canExport: { type: 'boolean' } }));

export const configResponse = envelope(obj({
  namePrefix: nullableString,
  excludeAdminsByDefault: { type: 'boolean' },
  defaultFormat: format,
  autoRefresh: { type: 'boolean' },
  autoRefreshAvailable: { type: 'boolean' },
  configured: { type: 'boolean' },
  updatedAt: nullableDate,
}));

export const platformContactsResponse = envelope(obj({
  items: {
    type: 'array',
    items: obj({
      id: { type: 'string' },
      name: nullableString,
      phone: nullableString,
      lid: nullableString,
      tenantCount: { type: 'integer' },
      groupCount: { type: 'integer' },
      firstSeenAt: date,
      lastSeenAt: date,
      firstExtractedAt: nullableDate,
      lastExtractedAt: nullableDate,
    }),
  },
  nextCursor: nullableString,
}));

const count = { type: 'integer' } as const;
export const platformSummaryResponse = envelope(obj({
  total: count,
  filtered: count,
  withPhone: count,
  lidOnly: count,
  topDdi: { type: 'array', items: obj({ ddi: { type: 'string' }, count }) },
  topDdd: { type: 'array', items: obj({ ddd: { type: 'string' }, count }) },
  ddiBase: count,
  dddBase: count,
}));

export const platformContactResponse = envelope(obj({
  contactId: { type: 'string' },
  links: {
    type: 'array',
    items: obj({
      tenantId: { type: 'string' },
      tenantName: { type: 'string' },
      groupId: { type: 'string' },
      groupName: { type: 'string' },
      name: nullableString,
      isAdmin: { type: 'boolean' },
      firstExtractedAt: date,
      lastExtractedAt: date,
      leftAt: nullableDate,
    }),
  },
}));

export const platformTenantsResponse = envelope(obj({
  items: { type: 'array', items: obj({ id: { type: 'string' }, name: { type: 'string' } }) },
  nextCursor: nullableString,
}));
