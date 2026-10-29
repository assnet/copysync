import { AppError } from '../AppError';

// ── Rodízio de links (.specs/features/link-rotation/design.md §4.2) ──────────
//
// `meta` vai ao cliente (errorHandler). Nunca levar dado de outro tenant: em
// LINK_SLUG_TAKEN só vão sugestões livres, não quem ocupa o nome.

/** Domínio ainda tem rotações apontando para ele (não pode excluir/pausar). */
export class LinkDomainInUseError extends AppError {
  constructor(domainId: string) {
    super('LINK_DOMAIN_IN_USE', 'Link domain is in use by rotations', 409, { domainId });
  }
}

/** Hostname fora do formato aceito (minúsculo, sem ponto final, sem esquema). */
export class LinkDomainInvalidError extends AppError {
  constructor(reason = 'Invalid link domain') {
    super('LINK_DOMAIN_INVALID', reason, 400);
  }
}

/** Nome do link fora da regra (3–50, a-z0-9 e hífen interno). */
export class LinkSlugInvalidError extends AppError {
  constructor(reason = 'Invalid link name') {
    super('LINK_SLUG_INVALID', reason, 400);
  }
}

/** Nome reservado pela plataforma ou pelo domínio. */
export class LinkSlugReservedError extends AppError {
  constructor(slug: string) {
    super('LINK_SLUG_RESERVED', 'Link name is reserved', 409, { slug });
  }
}

/** Nome já usado (ou reservado por 30 dias para outro tenant). `suggestions` = nomes livres. */
export class LinkSlugTakenError extends AppError {
  constructor(suggestions: readonly string[]) {
    super('LINK_SLUG_TAKEN', 'Link name is already taken', 409, { suggestions: [...suggestions] });
  }
}

export class LinkRotationNotFoundError extends AppError {
  constructor(id?: string) {
    super('LINK_ROTATION_NOT_FOUND', 'Link rotation not found', 404, id ? { id } : undefined);
  }
}

/** Conversa não é grupo da sessão da rotação/tenant, ou parâmetros (peso, teto) fora da faixa. */
export class LinkGroupInvalidError extends AppError {
  constructor(reason = 'Invalid group for link rotation', conversationId?: string) {
    super('LINK_GROUP_INVALID', reason, 400, conversationId ? { conversationId } : undefined);
  }
}

/** Link manual fora do formato `https://chat.whatsapp.com/<code>`. */
export class LinkInviteUrlInvalidError extends AppError {
  constructor(reason = 'Invalid group invite URL') {
    super('LINK_INVITE_URL_INVALID', reason, 400);
  }
}
