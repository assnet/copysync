import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { PlanFeatureUnavailableError } from '../../../../shared/errors/internal/PlanErrors';
import { NotFoundError, ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import type { IEntitlementSnapshotReader } from '../../../tenants/domain/contracts/IEntitlementSnapshotReader';
import type { ISaverConfigRepository, SaverConfigUpdate } from '../../domain/contracts/ISaverConfigRepository';
import type { ISaverExportGrantRepository } from '../../domain/contracts/ISaverExportGrantRepository';
import type { ISaverTeamReader } from '../../domain/contracts/ISaverTeamReader';
import { SaverExportFormat } from '../../domain/enums/SaverEnums';
import { readSaverFlag, SAVER_LIMIT_KEYS } from '../../domain/services/saverLimits';
import { assertSaverPermission, type SaverActor } from './saverActor';
import { SAVER_PREFIX_MAX } from './ExportSavedContactsUseCase';

/*
 * Configuração do Saver por tenant (SAVER-31, 32) e liberação de exportar para OPERATOR (SAVER-43).
 * Tudo exige `configure` (só ADMIN; SUPER_ADMIN como suporte). Permissão checada aqui, nunca no handler.
 */

export interface SaverConfigDTO {
  namePrefix: string | null;
  excludeAdminsByDefault: boolean;
  defaultFormat: SaverExportFormat;
  autoRefresh: boolean;
  /** Entitlement `saver_auto_refresh_enabled`: o painel desliga o Switch sem ele. */
  autoRefreshAvailable: boolean;
  /** false = tenant nunca salvou (padrões). */
  configured: boolean;
  updatedAt: Date | null;
}

export const SAVER_CONFIG_DEFAULTS = Object.freeze({
  namePrefix: null,
  excludeAdminsByDefault: false,
  defaultFormat: SaverExportFormat.CSV,
  autoRefresh: false,
});

export class GetSaverConfigUseCase {
  constructor(
    private readonly configs: ISaverConfigRepository,
    private readonly entitlements: IEntitlementSnapshotReader,
  ) {}

  async execute(actor: SaverActor): Promise<SaverConfigDTO> {
    await assertSaverPermission(actor, 'configure');
    const [config, snapshot] = await Promise.all([
      this.configs.findByTenant(actor.tenantId),
      this.entitlements.readAll(actor.tenantId),
    ]);
    const autoRefreshAvailable = readSaverFlag(snapshot, SAVER_LIMIT_KEYS.AUTO_REFRESH_ENABLED);
    if (!config) return { ...SAVER_CONFIG_DEFAULTS, autoRefreshAvailable, configured: false, updatedAt: null };
    return {
      namePrefix: config.namePrefix,
      excludeAdminsByDefault: config.excludeAdminsByDefault,
      defaultFormat: config.defaultFormat,
      autoRefresh: config.autoRefresh,
      autoRefreshAvailable,
      configured: true,
      updatedAt: config.updatedAt,
    };
  }
}

export interface UpdateSaverConfigInput {
  actor: SaverActor;
  namePrefix?: string | null;
  excludeAdminsByDefault?: boolean;
  defaultFormat?: SaverExportFormat;
  autoRefresh?: boolean;
}

export class UpdateSaverConfigUseCase {
  constructor(
    private readonly configs: ISaverConfigRepository,
    private readonly entitlements: IEntitlementSnapshotReader,
  ) {}

  async execute(input: UpdateSaverConfigInput): Promise<SaverConfigDTO> {
    const { actor } = input;
    await assertSaverPermission(actor, 'configure');
    const update: SaverConfigUpdate = {};
    if (input.namePrefix !== undefined) {
      const prefix = input.namePrefix?.trim() || null;
      if (prefix && prefix.length > SAVER_PREFIX_MAX) throw new ValidationError('Name prefix is too long', { field: 'namePrefix' });
      update.namePrefix = prefix;
    }
    if (input.excludeAdminsByDefault !== undefined) update.excludeAdminsByDefault = input.excludeAdminsByDefault === true;
    if (input.defaultFormat !== undefined) {
      if (!Object.values(SaverExportFormat).includes(input.defaultFormat)) {
        throw new ValidationError('Invalid export format', { field: 'defaultFormat' });
      }
      update.defaultFormat = input.defaultFormat;
    }
    const snapshot = await this.entitlements.readAll(actor.tenantId);
    const autoRefreshAvailable = readSaverFlag(snapshot, SAVER_LIMIT_KEYS.AUTO_REFRESH_ENABLED);
    if (input.autoRefresh !== undefined) {
      if (input.autoRefresh === true && !autoRefreshAvailable) {
        throw new PlanFeatureUnavailableError(SAVER_LIMIT_KEYS.AUTO_REFRESH_ENABLED);
      }
      update.autoRefresh = input.autoRefresh === true;
    }

    const saved = await this.configs.upsert(actor.tenantId, update);
    return {
      namePrefix: saved.namePrefix,
      excludeAdminsByDefault: saved.excludeAdminsByDefault,
      defaultFormat: saved.defaultFormat,
      autoRefresh: saved.autoRefresh,
      autoRefreshAvailable,
      configured: true,
      updatedAt: saved.updatedAt,
    };
  }
}

/** Operador do tenant e se pode exportar. Nome/e-mail só para a tela (borrados no painel), nunca em log. */
export interface SaverExportGrantDTO {
  userId: string;
  name: string;
  email: string;
  canExport: boolean;
}

export class ListSaverExportGrantsUseCase {
  constructor(
    private readonly team: ISaverTeamReader,
    private readonly grants: ISaverExportGrantRepository,
  ) {}

  async execute(actor: SaverActor): Promise<SaverExportGrantDTO[]> {
    await assertSaverPermission(actor, 'configure');
    const [members, granted] = await Promise.all([
      this.team.listMembers(actor.tenantId),
      this.grants.listByTenant(actor.tenantId),
    ]);
    const grantedIds = new Set(granted.map((g) => g.userId));
    return members
      .filter((m) => m.role === 'OPERATOR')
      .map((m) => ({ userId: m.userId, name: m.name, email: m.email, canExport: grantedIds.has(m.userId) }));
  }
}

export interface SetSaverExportGrantInput {
  actor: SaverActor;
  targetUserId: string;
  canExport: boolean;
}

/** Liga/desliga "pode exportar" de um OPERATOR do mesmo tenant. Ligar duas vezes = 1 linha; sem mudança, sem auditoria. */
export class SetSaverExportGrantUseCase {
  constructor(
    private readonly team: ISaverTeamReader,
    private readonly grants: ISaverExportGrantRepository,
    private readonly audit: IAuditLogRepository,
  ) {}

  async execute(input: SetSaverExportGrantInput): Promise<{ userId: string; canExport: boolean }> {
    const { actor, targetUserId } = input;
    await assertSaverPermission(actor, 'configure');
    const target = await this.team.findMember(actor.tenantId, targetUserId);
    if (!target) throw new NotFoundError('TenantMember', targetUserId);
    if (target.role !== 'OPERATOR') {
      throw new ValidationError('Export permission can only be set for operators', { field: 'userId' });
    }

    const enable = input.canExport === true;
    const current = await this.grants.hasGrant(actor.tenantId, targetUserId);
    if (current !== enable) {
      if (enable) await this.grants.grant(actor.tenantId, targetUserId, actor.userId);
      else await this.grants.revoke(actor.tenantId, targetUserId);
      await this.audit.create({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'SAVER_PERMISSION_CHANGED',
        meta: { targetUserId, permission: 'export', enabled: enable },
      });
    }
    return { userId: targetUserId, canExport: enable };
  }
}
