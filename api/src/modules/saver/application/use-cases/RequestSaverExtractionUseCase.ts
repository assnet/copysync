import type { IEntitlementSnapshotReader } from '../../../tenants/domain/contracts/IEntitlementSnapshotReader';
import type { IProductAccessReader } from '../../../tenants/domain/contracts/IProductAccessReader';
import type { ISaverExtractionQueue } from '../../domain/contracts/ISaverExtractionQueue';
import type { ISaverSessionReader } from '../../domain/contracts/ISaverSessionReader';
import { fitsSaverLimit, SAVER_LIMIT_KEYS } from '../../domain/services/saverLimits';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import { SAVER_SCAN_WINDOW_MS } from './GetSaverOverviewUseCase';
import type { SaverGroupListingEngine } from './ListSaverSessionGroupsUseCase';
import { assertCanSaver, type SaverActor } from './saverActor';
import { loadSaverLimits } from './saverEffectiveLimits';
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
  products: Pick<IProductAccessReader, 'has'>;
  queue: Pick<ISaverExtractionQueue, 'requestGroups'>;
  engine: () => SaverGroupListingEngine;
  now?: () => Date;
}

/**
 * Pede a leitura de N grupos da sessão (SAVER-09, SAVER-10). Valida `saver_groups` (salvos + novos) e
 * `saver_group_scans_per_day` (24 h corridas) ANTES de gravar, sob a trava do tenant (`requestGroups`);
 * grupo já pendente não duplica (fila ignora).
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
    // SAVER-47: super admin sem o produto no tenant valida pelo preset SAVER_MAX.
    const { limits } = await loadSaverLimits(this.deps, actor);
    // Contagem, gravação e fila numa transação sob a trava do tenant: pedidos simultâneos não passam do teto.
    const extraction = await this.deps.queue.requestGroups(
      {
        tenantId,
        sessionId: session.id,
        requestedByUserId: actor.userId,
        groups: jids.map((j) => ({ groupJid: j, name: live.get(j) || null })),
        scansSince: new Date(now.getTime() - SAVER_SCAN_WINDOW_MS),
        now,
      },
      ({ activeCount, activeRequested, scansUsed }) => {
        if (!fitsSaverLimit(limits.groups, activeCount, jids.length - activeRequested)) {
          throw new PlanLimitReachedError(SAVER_LIMIT_KEYS.GROUPS, limits.groups ?? 0);
        }
        if (!fitsSaverLimit(limits.groupScansPerDay, scansUsed, jids.length)) {
          throw new PlanLimitReachedError(SAVER_LIMIT_KEYS.GROUP_SCANS_PER_DAY, limits.groupScansPerDay ?? 0);
        }
      },
    );
    return toSaverExtractionDTO(extraction);
  }
}
