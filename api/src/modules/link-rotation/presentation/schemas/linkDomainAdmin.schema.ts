import { MAX_RESERVED_NAMES } from '../../application/use-cases/admin/linkDomainRules';
import { LinkDomainStatus } from '../../domain/enums/LinkRotationEnums';

/*
 * Schemas fechados na entrada e na saída. Forma fina de hostname, landing e nomes reservados
 * é validada no use case (LINK_DOMAIN_INVALID); aqui só tipo e teto.
 */
const id = { type: 'string', minLength: 1, maxLength: 64 } as const;
const landingUrl = { type: ['string', 'null'], maxLength: 2048 } as const;
const reservedNames = { type: 'array', maxItems: MAX_RESERVED_NAMES, items: { type: 'string', maxLength: 63 } } as const;
const nullableDate = { type: ['string', 'null'], format: 'date-time' } as const;

const envelope = (data: object) => ({
  type: 'object',
  additionalProperties: false,
  properties: { success: { type: 'boolean' }, data },
});

export const linkDomainIdParamSchema = {
  type: 'object',
  required: ['id'],
  properties: { id },
} as const;

export const createLinkDomainBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['hostname'],
  properties: { hostname: { type: 'string', minLength: 1, maxLength: 253 }, landingUrl, reservedNames },
} as const;

/** Hostname não muda (excluir e cadastrar). `landingUrl: null` remove a landing. */
export const updateLinkDomainBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    status: { type: 'string', enum: Object.values(LinkDomainStatus) },
    landingUrl,
    reservedNames,
  },
} as const;

const domain = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    hostname: { type: 'string' },
    status: { type: 'string', enum: Object.values(LinkDomainStatus) },
    landingUrl: { type: ['string', 'null'] },
    reservedNames: { type: 'array', items: { type: 'string' } },
    lastProbeAt: nullableDate,
    lastProbeOk: { type: ['boolean', 'null'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const linkDomainResponse = envelope(domain);

export const linkDomainListResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: { items: { type: 'array', items: domain } },
});

export const linkDomainProbeResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    reason: { type: ['string', 'null'] },
    status: { type: ['integer', 'null'] },
    probedAt: { type: 'string', format: 'date-time' },
  },
});
