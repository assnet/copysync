import type { IEntitlementSnapshotReader } from '../../../tenants/domain/contracts/IEntitlementSnapshotReader';
import type { ISaverConfigRepository } from '../../domain/contracts/ISaverConfigRepository';
import type { ISaverExportGrantRepository } from '../../domain/contracts/ISaverExportGrantRepository';
import type { ISaverExtractionQueue } from '../../domain/contracts/ISaverExtractionQueue';
import type { ISaverGroupRepository } from '../../domain/contracts/ISaverGroupRepository';
import type { ISaverMembershipRepository } from '../../domain/contracts/ISaverMembershipRepository';
import type { SaverConfig } from '../../domain/entities/SaverEntities';
import { SaverExportFormat } from '../../domain/enums/SaverEnums';
import { readSaverLimits, remainingSaverLimit, type SaverLimit } from '../../domain/services/saverLimits';
import { saverPermissionSet, type SaverPermissionSet } from '../../domain/services/saverPermissions';
import { assertCanSaver, loadSaverGrants, type SaverActor } from './saverActor';

export const SAVER_SCAN_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SaverUsageDTO {
  used: number;
  /** `null` = ilimitado. */
  limit: SaverLimit;
  /** `null` = ilimitado. */
  remaining: number | null;
}

export interface SaverConfigDTO {
  namePrefix: string | null;
  excludeAdminsByDefault: boolean;
  defaultFormat: SaverExportFormat;
  autoRefresh: boolean;
}

export interface SaverOverviewDTO {
  groups: SaverUsageDTO;
  contacts: SaverUsageDTO;
  /** Leituras de grupo nas últimas 24 h corridas. */
  groupScansPerDay: SaverUsageDTO;
  autoRefreshEnabled: boolean;
  permissions: SaverPermissionSet;
  config: SaverConfigDTO;
  /** `false` = job de extração desligado neste ambiente (fila parada). */
  queueRunning: boolean;
}

/** Tenant sem linha em `saver_configs`. */
export const SAVER_CONFIG_DEFAULTS: SaverConfigDTO = Object.freeze({
  namePrefix: null,
  excludeAdminsByDefault: false,
  defaultFormat: SaverExportFormat.CSV,
  autoRefresh: false,
});

export interface GetSaverOverviewDeps {
  entitlements: IEntitlementSnapshotReader;
  groups: Pick<ISaverGroupRepository, 'countActive'>;
  memberships: Pick<ISaverMembershipRepository, 'countDistinctContacts'>;
  queue: Pick<ISaverExtractionQueue, 'countScansSince'>;
  configs: Pick<ISaverConfigRepository, 'findByTenant'>;
  exportGrants: Pick<ISaverExportGrantRepository, 'hasGrant'>;
  /** Flag do job lida a cada chamada. */
  queueRunning: () => boolean;
  now?: () => Date;
}

const usage = (limit: SaverLimit, used: number): SaverUsageDTO => ({ used, limit, remaining: remainingSaverLimit(limit, used) });

const toConfigDTO = (c: SaverConfig | null): SaverConfigDTO =>
  c
    ? { namePrefix: c.namePrefix, excludeAdminsByDefault: c.excludeAdminsByDefault, defaultFormat: c.defaultFormat, autoRefresh: c.autoRefresh }
    : { ...SAVER_CONFIG_DEFAULTS };

/** Resumo do Saver numa chamada (SAVER-05, SAVER-18): limites, uso do tenant, permissões efetivas e config. */
export class GetSaverOverviewUseCase {
  constructor(private readonly deps: GetSaverOverviewDeps) {}

  async execute(actor: SaverActor): Promise<SaverOverviewDTO> {
    assertCanSaver(actor, 'view');
    const { tenantId } = actor;
    const now = this.deps.now?.() ?? new Date();
    const [snapshot, groupsUsed, contactsUsed, scansUsed, config, grants] = await Promise.all([
      this.deps.entitlements.readAll(tenantId),
      this.deps.groups.countActive(tenantId),
      this.deps.memberships.countDistinctContacts(tenantId),
      this.deps.queue.countScansSince(tenantId, new Date(now.getTime() - SAVER_SCAN_WINDOW_MS)),
      this.deps.configs.findByTenant(tenantId),
      loadSaverGrants(this.deps.exportGrants, actor),
    ]);
    const limits = readSaverLimits(snapshot);
    return {
      groups: usage(limits.groups, groupsUsed),
      contacts: usage(limits.contacts, contactsUsed),
      groupScansPerDay: usage(limits.groupScansPerDay, scansUsed),
      autoRefreshEnabled: limits.autoRefreshEnabled,
      permissions: saverPermissionSet(actor.role, grants),
      config: toConfigDTO(config),
      queueRunning: this.deps.queueRunning(),
    };
  }
}
