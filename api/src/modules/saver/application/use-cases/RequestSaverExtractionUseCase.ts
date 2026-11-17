import type { IEntitlementSnapshotReader } from '../../../tenants/domain/contracts/IEntitlementSnapshotReader';
import type { ISaverExtractionQueue } from '../../domain/contracts/ISaverExtractionQueue';
import type { ISaverGroupRepository } from '../../domain/contracts/ISaverGroupRepository';
import type { ISaverSessionReader } from '../../domain/contracts/ISaverSessionReader';
import { SaverExtractionTrigger } from '../../domain/enums/SaverEnums';
import { fitsSaverLimit, readSaverLimits, SAVER_LIMIT_KEYS } from '../../domain/services/saverLimits';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import { SAVER_SCAN_WINDOW_MS } from './GetSaverOverviewUseCase';
import type { SaverGroupListingEngine } from './ListSaverSessionGroupsUseCase';
import { assertCanSaver, type SaverActor } from './saverActor';
import { toSaverExtractionDTO, type SaverExtractionDTO } from './saverExtractionDTO';
import { bareGroupJid, requireSaverSession } from './saverSessionAccess';

export const SAVER_MAX_GROUPS_PER_REQUEST = 50;

export interface RequestSaverExtractionInput {
  sessionId: string;
  groupJids: readonly string[];
}

export interface RequestSaverExtractionDeps {
  sessions: ISaverSessionReader;
  entitlements: IEntitlementSnapshotReader;
  groups: Pick<ISaverGroupRepository, 'findByJids' | 'countActive' | 'upsertMany'>;
  queue: Pick<ISaverExtractionQueue, 'countScansSince' | 'enqueue'>;
  engine: () => SaverGroupListingEngine;
  now?: () => Date;
}

/**
 * Pede a leitura de N grupos da sessão (SAVER-09, SAVER-10). Valida `saver_groups` (salvos + novos) e
 * `saver_group_scans_per_day` (24 h corridas) ANTES de gravar; grupo já pendente não duplica (fila ignora).
 * Grupo removido pedido de novo é reativado (conta de novo no limite).
 */
export class RequestSaverExtractionUseCase {
  constructor(private readonly deps: RequestSaverExtractionDeps) {}

  async execute(actor: SaverActor, input: RequestSaverExtractionInput): Promise<SaverExtractionDTO> {
    assertCanSaver(actor, 'extract');
    const { tenantId } = actor;
    const jids = [...new Set(input.groupJids.map(bareGroupJid).filter((j) => j.length > 0))];
    if (jids.length === 0 || jids.length > SAVER_MAX_GROUPS_PER_REQUEST) {
      throw new ValidationError('groupJids must have between 1 and 50 groups', { field: 'groupJids' });
    }
    const session = await requireSaverSession(this.deps.sessions, tenantId, input.sessionId);

    const live = new Map<string, string | null>();
    for (const g of await this.deps.engine().listParticipatingGroups(session.id)) live.set(bareGroupJid(g.groupJid), g.name);
    const missing = jids.filter((j) => !live.has(j));
    if (missing.length > 0) {
      throw new ValidationError('Some groups are not available in this session', { field: 'groupJids', missing: missing.length });
    }

    const now = this.deps.now?.() ?? new Date();
    const [snapshot, existing, activeCount, scansUsed] = await Promise.all([
      this.deps.entitlements.readAll(tenantId),
      this.deps.groups.findByJids(tenantId, jids),
      this.deps.groups.countActive(tenantId),
      this.deps.queue.countScansSince(tenantId, new Date(now.getTime() - SAVER_SCAN_WINDOW_MS)),
    ]);
    const limits = readSaverLimits(snapshot);
    const activeJids = new Set(existing.filter((g) => g.removedAt === null).map((g) => g.groupJid));
    const adding = jids.filter((j) => !activeJids.has(j)).length;
    if (!fitsSaverLimit(limits.groups, activeCount, adding)) {
      throw new PlanLimitReachedError(SAVER_LIMIT_KEYS.GROUPS, limits.groups ?? 0);
    }
    if (!fitsSaverLimit(limits.groupScansPerDay, scansUsed, jids.length)) {
      throw new PlanLimitReachedError(SAVER_LIMIT_KEYS.GROUP_SCANS_PER_DAY, limits.groupScansPerDay ?? 0);
    }

    const names = new Map(existing.map((g) => [g.groupJid, g.name]));
    const saved = await this.deps.groups.upsertMany(
      tenantId,
      session.id,
      jids.map((j) => ({ groupJid: j, name: live.get(j) || names.get(j) || j })),
    );
    const extraction = await this.deps.queue.enqueue({
      tenantId,
      sessionId: session.id,
      requestedByUserId: actor.userId,
      trigger: SaverExtractionTrigger.MANUAL,
      groupIds: saved.map((g) => g.id),
      now,
    });
    return toSaverExtractionDTO(extraction);
  }
}
