import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { ILinkRotationMemberSyncStore, MemberSyncDueGroup } from '../../domain/contracts/ILinkRotationMemberSyncStore';
import { LinkRotationGroupStatus } from '../../domain/enums/LinkRotationEnums';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import { logger } from '../../../../shared/logger/logger';

/** Teto normal: 1 leitura por grupo a cada 15 min (design.md §4.2). */
export const MEMBER_SYNC_STALE_MS = 15 * 60_000;
/** Rajada de cliques antecipa a leitura… */
export const MEMBER_SYNC_CLICK_BURST = 25;
/** …mas nunca antes de 2 min da anterior (piso: rajada contínua não vira 1 chamada/min). */
export const MEMBER_SYNC_BURST_MIN_MS = 2 * 60_000;
/** Grupos por tick (60 s): no máximo 50 chamadas/min ao WhatsApp somando todas as sessões. */
export const MEMBER_SYNC_BATCH = 50;
/** Orçamento de tempo do tick: não começa leitura nova depois disso (abaixo do lease de 5 min). */
export const MEMBER_SYNC_BUDGET_MS = 4 * 60_000;

export interface SyncLinkRotationMembersDeps {
  store: ILinkRotationMemberSyncStore;
  engine: Pick<IMessagingEngine, 'getGroupSummary'>;
  now?: () => Date;
  batchSize?: number;
  budgetMs?: number;
}

export interface SyncLinkRotationMembersResult {
  processed: number;
  synced: number;
  skipped: number;
  failed: number;
}

/**
 * Job de membros do rodízio: lê `memberCount` dos grupos vencidos via sessão e ajusta
 * FULL ↔ ACTIVE pelo teto (`capacity`). Sequencial (uma chamada por vez, sessão a sessão).
 * Sessão desconectada: pula o grupo e o resto da sessão no tick, sem gravar.
 * Outro erro: marca a tentativa (respeita o teto de 15 min) e segue para o próximo grupo.
 */
export class SyncLinkRotationMembersUseCase {
  private readonly log = logger.child({ module: 'SyncLinkRotationMembersUseCase' });

  constructor(private readonly deps: SyncLinkRotationMembersDeps) {}

  async execute(): Promise<SyncLinkRotationMembersResult> {
    const clock = this.deps.now ?? (() => new Date());
    const now = clock();
    const deadline = now.getTime() + (this.deps.budgetMs ?? MEMBER_SYNC_BUDGET_MS);
    const due = await this.deps.store.listDue({
      staleBefore: new Date(now.getTime() - MEMBER_SYNC_STALE_MS),
      burstBefore: new Date(now.getTime() - MEMBER_SYNC_BURST_MIN_MS),
      clickBurst: MEMBER_SYNC_CLICK_BURST,
      limit: this.deps.batchSize ?? MEMBER_SYNC_BATCH,
    });

    const result: SyncLinkRotationMembersResult = { processed: due.length, synced: 0, skipped: 0, failed: 0 };
    const offline = new Set<string>();
    for (const group of bySession(due)) {
      if (offline.has(group.sessionId) || clock().getTime() > deadline) {
        result.skipped++;
        continue;
      }
      const outcome = await this.syncOne(group, now);
      if (outcome === 'offline') offline.add(group.sessionId);
      if (outcome === 'synced') result.synced++;
      else if (outcome === 'offline') result.skipped++;
      else result.failed++;
    }
    return result;
  }

  private async syncOne(group: MemberSyncDueGroup, now: Date): Promise<'synced' | 'offline' | 'failed'> {
    let memberCount: number;
    try {
      ({ memberCount } = await this.deps.engine.getGroupSummary(group.sessionId, group.groupJid));
    } catch (err) {
      if (err instanceof SessionNotConnectedError) return 'offline';
      this.log.warn({ err: (err as Error)?.name, groupId: group.id }, 'member sync read failed');
      await this.deps.store.markAttempt(group.tenantId, group.id, now).catch(() => undefined);
      return 'failed';
    }
    try {
      await this.deps.store.applyMemberCount({
        tenantId: group.tenantId,
        groupId: group.id,
        memberCount,
        at: now,
        clicksSeen: group.clicksSinceSync,
        status: memberCount >= group.capacity ? LinkRotationGroupStatus.FULL : LinkRotationGroupStatus.ACTIVE,
      });
      return 'synced';
    } catch (err) {
      this.log.error({ err: (err as Error)?.name, groupId: group.id }, 'member sync write failed');
      return 'failed';
    }
  }
}

/** Agrupa por sessão mantendo a ordem de chegada (o mais vencido puxa a sessão para frente). */
function bySession(groups: MemberSyncDueGroup[]): MemberSyncDueGroup[] {
  const map = new Map<string, MemberSyncDueGroup[]>();
  for (const g of groups) {
    const list = map.get(g.sessionId);
    if (list) list.push(g);
    else map.set(g.sessionId, [g]);
  }
  return [...map.values()].flat();
}
