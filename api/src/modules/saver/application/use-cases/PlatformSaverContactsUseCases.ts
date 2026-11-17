import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { ForbiddenError } from '../../../../shared/errors/internal/AuthErrors';
import { NotFoundError, ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import { SaverCursorInvalidError } from '../../../../shared/errors/internal/SaverExportErrors';
import type {
  IPlatformSaverContactRepository,
  PlatformSaverContactFilter,
  PlatformSaverContactKey,
  PlatformSaverContactLink,
  PlatformSaverContactRow,
  PlatformSaverTenant,
  PlatformSaverTenantKey,
} from '../../domain/contracts/IPlatformSaverContactRepository';
import { platformCsvHeader, toPlatformCsvLine } from '../../domain/services/exportFormatters';
import {
  createPlatformSaverContactCursor,
  createPlatformSaverTenantCursor,
  platformSaverContactScope,
  readPlatformSaverContactCursor,
  readPlatformSaverTenantCursor,
} from '../platformSaverContactCursor';

/*
 * Base de contatos da PLATAFORMA (SAVER-45). Só `SUPER_ADMIN`, checado aqui (a rota também checa).
 * Lista por cursor keyset assinado (inválido/de outro filtro = 400, nunca offset; tamanho de página fixo).
 * Toda consulta e exportação grava `AuditLog` sem nome, número, LID nem texto da busca.
 */

export const PLATFORM_SAVER_PAGE_SIZE = 50;
export const PLATFORM_SAVER_EXPORT_BATCH = 1000;
export const PLATFORM_SAVER_TENANT_PAGE_SIZE = 100;
const SEARCH_MAX = 100;

export interface PlatformSaverActor {
  userId: string;
  isSuperAdmin: boolean;
}

export interface PlatformSaverContactQuery {
  search?: string | null;
  tenantId?: string | null;
  from?: Date | null;
  to?: Date | null;
}

export interface ListPlatformSaverContactsInput extends PlatformSaverContactQuery {
  actor: PlatformSaverActor;
  cursor?: string | null;
}

export interface ListPlatformSaverContactsOutput {
  items: PlatformSaverContactRow[];
  nextCursor: string | null;
}

function assertSuperAdmin(actor: PlatformSaverActor): void {
  if (!actor.isSuperAdmin) throw new ForbiddenError('Only super admins can access the platform contact base');
}

function toFilter(q: PlatformSaverContactQuery): PlatformSaverContactFilter {
  const search = q.search?.trim() || null;
  if (search && search.length > SEARCH_MAX) throw new ValidationError('Search is too long', { field: 'search' });
  const from = q.from ?? null;
  const to = q.to ?? null;
  for (const [field, d] of [['from', from], ['to', to]] as const) {
    if (d && Number.isNaN(d.getTime())) throw new ValidationError('Invalid date', { field });
  }
  if (from && to && from > to) throw new ValidationError('Start date must be before end date', { field: 'from' });
  return { search, tenantId: q.tenantId?.trim() || null, from, to };
}

/** Filtros para o `AuditLog`: nunca o texto da busca (pode ser nome ou número). */
function auditFilters(f: PlatformSaverContactFilter): Record<string, unknown> {
  return {
    hasSearch: f.search !== null,
    tenantId: f.tenantId,
    from: f.from?.toISOString() ?? null,
    to: f.to?.toISOString() ?? null,
  };
}

export class ListPlatformSaverContactsUseCase {
  constructor(
    private readonly contacts: IPlatformSaverContactRepository,
    private readonly audit: IAuditLogRepository,
  ) {}

  async execute(input: ListPlatformSaverContactsInput): Promise<ListPlatformSaverContactsOutput> {
    assertSuperAdmin(input.actor);
    const filter = toFilter(input);
    const scope = platformSaverContactScope(filter);
    let after: PlatformSaverContactKey | null = null;
    if (input.cursor) {
      after = readPlatformSaverContactCursor(input.cursor, scope);
      if (!after) throw new SaverCursorInvalidError();
    }

    const rows = await this.contacts.list(filter, after, PLATFORM_SAVER_PAGE_SIZE + 1);
    const items = rows.slice(0, PLATFORM_SAVER_PAGE_SIZE);
    const last = items[items.length - 1];
    const nextCursor =
      rows.length > PLATFORM_SAVER_PAGE_SIZE && last
        ? createPlatformSaverContactCursor(scope, { lastSeenAt: last.lastSeenAt, id: last.id })
        : null;

    await this.audit.create({
      userId: input.actor.userId,
      action: 'SAVER_PLATFORM_VIEWED',
      meta: { kind: 'list', filters: auditFilters(filter), page: after ? 'next' : 'first', count: items.length },
    });
    return { items, nextCursor };
  }
}

export interface GetPlatformSaverContactInput {
  actor: PlatformSaverActor;
  contactId: string;
}

/** Extrações do contato: tenant, grupo e data e hora de cada vínculo. */
export class GetPlatformSaverContactUseCase {
  constructor(
    private readonly contacts: IPlatformSaverContactRepository,
    private readonly audit: IAuditLogRepository,
  ) {}

  async execute(input: GetPlatformSaverContactInput): Promise<{ contactId: string; links: PlatformSaverContactLink[] }> {
    assertSuperAdmin(input.actor);
    const links = await this.contacts.findLinks(input.contactId);
    if (links.length === 0) throw new NotFoundError('SaverContact', input.contactId);
    await this.audit.create({
      userId: input.actor.userId,
      action: 'SAVER_PLATFORM_VIEWED',
      meta: { kind: 'detail', contactId: input.contactId, count: links.length },
    });
    return { contactId: input.contactId, links };
  }
}

export interface ListPlatformSaverTenantsInput {
  actor: PlatformSaverActor;
  cursor?: string | null;
}

export interface ListPlatformSaverTenantsOutput {
  items: PlatformSaverTenant[];
  nextCursor: string | null;
}

/**
 * Contas com vínculo no Saver para o seletor do filtro (id e nome). Por cursor keyset assinado (pode passar
 * de centenas); tamanho de página fixo. Sem auditoria: só nome de conta, nenhum dado de contato.
 */
export class ListPlatformSaverTenantsUseCase {
  constructor(private readonly contacts: IPlatformSaverContactRepository) {}

  async execute(input: ListPlatformSaverTenantsInput): Promise<ListPlatformSaverTenantsOutput> {
    assertSuperAdmin(input.actor);
    let after: PlatformSaverTenantKey | null = null;
    if (input.cursor) {
      after = readPlatformSaverTenantCursor(input.cursor);
      if (!after) throw new SaverCursorInvalidError();
    }
    const rows = await this.contacts.listTenants(after, PLATFORM_SAVER_TENANT_PAGE_SIZE + 1);
    const items = rows.slice(0, PLATFORM_SAVER_TENANT_PAGE_SIZE);
    const last = items[items.length - 1];
    const nextCursor =
      rows.length > PLATFORM_SAVER_TENANT_PAGE_SIZE && last ? createPlatformSaverTenantCursor({ name: last.name, id: last.id }) : null;
    return { items, nextCursor };
  }
}

export interface ExportPlatformSaverContactsInput extends PlatformSaverContactQuery {
  actor: PlatformSaverActor;
}

export interface PlatformSaverExportFile {
  fileName: string;
  contentType: string;
  /** Linhas CSV (cabeçalho com BOM primeiro), por keyset em lotes; nunca a base inteira em memória. */
  lines: AsyncIterable<string>;
}

/**
 * Exportação CSV da base por stream. Validação e permissão antes do primeiro byte. O `AuditLog`
 * `SAVER_PLATFORM_EXPORTED` (filtros e quantidade) é gravado ao fim do stream, também se interrompido.
 */
export class ExportPlatformSaverContactsUseCase {
  constructor(
    private readonly contacts: IPlatformSaverContactRepository,
    private readonly audit: IAuditLogRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: ExportPlatformSaverContactsInput): Promise<PlatformSaverExportFile> {
    assertSuperAdmin(input.actor);
    const filter = toFilter(input);
    const date = this.now().toISOString().slice(0, 10);
    return {
      fileName: `base-de-contatos-${date}.csv`,
      contentType: 'text/csv; charset=utf-8',
      lines: this.stream(filter, input.actor.userId),
    };
  }

  private async *stream(filter: PlatformSaverContactFilter, userId: string): AsyncGenerator<string> {
    let count = 0;
    let completed = false;
    try {
      yield platformCsvHeader();
      let after: PlatformSaverContactKey | null = null;
      for (;;) {
        const rows = await this.contacts.list(filter, after, PLATFORM_SAVER_EXPORT_BATCH);
        for (const row of rows) {
          count++;
          yield toPlatformCsvLine(row);
        }
        const last = rows[rows.length - 1];
        if (rows.length < PLATFORM_SAVER_EXPORT_BATCH || !last) break;
        after = { lastSeenAt: last.lastSeenAt, id: last.id };
      }
      completed = true;
    } finally {
      await this.audit.create({
        userId,
        action: 'SAVER_PLATFORM_EXPORTED',
        meta: { format: 'CSV', filters: auditFilters(filter), count, completed },
      });
    }
  }
}
