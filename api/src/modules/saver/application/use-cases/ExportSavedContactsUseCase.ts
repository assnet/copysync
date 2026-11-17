import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { NotFoundError, ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import { SaverExportEmptyError } from '../../../../shared/errors/internal/SaverExportErrors';
import type { ISaverExportGrantRepository } from '../../domain/contracts/ISaverExportGrantRepository';
import type { ISaverGroupRepository } from '../../domain/contracts/ISaverGroupRepository';
import type {
  ISaverMembershipRepository,
  SaverMembershipExportQuery,
} from '../../domain/contracts/ISaverMembershipRepository';
import { SaverExportFormat } from '../../domain/enums/SaverEnums';
import {
  applyExportOptions,
  csvHeader,
  toCsvLine,
  toVCardEntry,
  type SaverExportOptions,
} from '../../domain/services/exportFormatters';
import { assertSaverPermission, type SaverActor } from './saverActor';

export const SAVER_EXPORT_BATCH = 1000;
/** Tamanho máximo do prefixo de nome (exportação e configuração). */
export const SAVER_PREFIX_MAX = 40;

export interface ExportSavedContactsInput {
  actor: SaverActor;
  format: SaverExportFormat;
  /** Grupos salvos do tenant (um, vários) ou todos os não removidos. */
  groupIds: readonly string[] | 'all';
  options?: SaverExportOptions;
}

export interface SavedContactsExportFile {
  format: SaverExportFormat;
  fileName: string;
  contentType: string;
  /** Linhas que entram no arquivo (contagem prévia). */
  total: number;
  /** vCard: contatos só com LID que ficam fora (sem número). CSV: 0. */
  skippedWithoutPhone: number;
  /** Conteúdo por keyset em lotes de 1.000; consumir como stream, nunca montar em memória. */
  lines: AsyncIterable<string>;
}

/**
 * Exportação do tenant (SAVER-25..30, 46). Permissão `export` (OPERATOR só com liberação), grupos do
 * próprio tenant não removidos, contagem antes do primeiro byte (vazio = 422) e `AuditLog SAVER_EXPORTED`
 * ao fim do stream (`count`, `completed`) com formato, filtros e quantidade, nunca nome, número ou LID. O nome é o do VÍNCULO (lido pelo tenant),
 * nunca o do contato da base da plataforma: o repositório de vínculos nem expõe o outro.
 */
export class ExportSavedContactsUseCase {
  constructor(
    private readonly groups: ISaverGroupRepository,
    private readonly memberships: ISaverMembershipRepository,
    private readonly grants: Pick<ISaverExportGrantRepository, 'hasGrant'>,
    private readonly audit: IAuditLogRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: ExportSavedContactsInput): Promise<SavedContactsExportFile> {
    const { actor } = input;
    await assertSaverPermission(actor, 'export', this.grants);
    if (!Object.values(SaverExportFormat).includes(input.format)) {
      throw new ValidationError('Invalid export format', { field: 'format' });
    }
    const opts = normalizeOptions(input.options);
    const groupIds = await this.resolveGroups(actor.tenantId, input.groupIds);

    const query: SaverMembershipExportQuery = {
      tenantId: actor.tenantId,
      groupIds,
      onlyWithPhone: opts.onlyWithPhone === true,
      onlyActive: opts.onlyActive === true,
      excludeAdmins: opts.excludeAdmins === true,
      onePerGroup: opts.onePerGroup === true,
    };
    const count = await this.memberships.countForExport(query);
    const isVCard = input.format === SaverExportFormat.VCARD;
    const total = isVCard ? count.withPhone : count.total;
    const skippedWithoutPhone = isVCard ? count.lidOnly : 0;
    if (total <= 0) throw new SaverExportEmptyError(input.format);

    const auditMeta: SaverExportAuditMeta = {
      tenantId: actor.tenantId,
      userId: actor.userId,
      meta: {
        format: input.format,
        groupIds,
        allGroups: input.groupIds === 'all',
        options: {
          hasPrefix: Boolean(opts.prefix),
          excludeAdmins: query.excludeAdmins,
          onlyWithPhone: query.onlyWithPhone,
          onlyActive: query.onlyActive,
          onePerGroup: query.onePerGroup,
        },
        expectedCount: total,
        skippedWithoutPhone,
      },
    };

    const date = this.now().toISOString().slice(0, 10);
    return {
      format: input.format,
      fileName: `contatos-${date}.${isVCard ? 'vcf' : 'csv'}`,
      contentType: isVCard ? 'text/vcard; charset=utf-8' : 'text/csv; charset=utf-8',
      total,
      skippedWithoutPhone,
      lines: this.stream(query, input.format, opts, auditMeta),
    };
  }

  private async resolveGroups(tenantId: string, requested: readonly string[] | 'all'): Promise<string[]> {
    const active = await this.groups.listActive(tenantId);
    if (requested === 'all') {
      if (active.length === 0) throw new SaverExportEmptyError('ALL_GROUPS');
      return active.map((g) => g.id);
    }
    const ids = [...new Set(requested)];
    if (ids.length === 0) throw new ValidationError('Select at least one group', { field: 'groupIds' });
    const activeIds = new Set(active.map((g) => g.id));
    // Grupo de outro tenant ou removido: não encontrado (não revela se existe em outro tenant).
    for (const id of ids) if (!activeIds.has(id)) throw new NotFoundError('SaverGroup', id);
    return ids;
  }

  /**
   * Auditoria no `finally` do gerador (como na exportação da plataforma): `count` = linhas de contato
   * entregues e `completed` = chegou ao fim; download interrompido fica registrado como incompleto.
   */
  private async *stream(
    query: SaverMembershipExportQuery,
    format: SaverExportFormat,
    opts: SaverExportOptions,
    audit: SaverExportAuditMeta,
  ): AsyncGenerator<string> {
    const isVCard = format === SaverExportFormat.VCARD;
    let count = 0;
    let completed = false;
    try {
      if (!isVCard) yield csvHeader(opts);
      for await (const batch of this.memberships.exportBatches(query, SAVER_EXPORT_BATCH)) {
        for (const row of batch) {
          const line = applyExportOptions(
            {
              name: row.name,
              phone: row.phone,
              lid: row.lid,
              isAdmin: row.isAdmin,
              active: row.active,
              extractedAt: row.extractedAt,
              groupName: row.groupName,
            },
            opts,
          );
          if (!line) continue;
          const out = isVCard ? toVCardEntry(line) : toCsvLine(line, opts);
          if (!out) continue;
          count++;
          yield out;
        }
      }
      completed = true;
    } finally {
      await this.audit.create({
        tenantId: audit.tenantId,
        userId: audit.userId,
        action: 'SAVER_EXPORTED',
        meta: { ...audit.meta, count, completed },
      });
    }
  }
}

/** Formato, filtros e contagens; nunca nome, número ou LID. */
interface SaverExportAuditMeta {
  tenantId: string;
  userId: string;
  meta: Record<string, unknown>;
}

function normalizeOptions(raw: SaverExportOptions | undefined): SaverExportOptions {
  const prefix = raw?.prefix?.trim() || null;
  if (prefix && prefix.length > SAVER_PREFIX_MAX) throw new ValidationError('Name prefix is too long', { field: 'prefix' });
  return {
    prefix,
    excludeAdmins: raw?.excludeAdmins === true,
    onlyWithPhone: raw?.onlyWithPhone === true,
    onlyActive: raw?.onlyActive === true,
    onePerGroup: raw?.onePerGroup === true,
  };
}
