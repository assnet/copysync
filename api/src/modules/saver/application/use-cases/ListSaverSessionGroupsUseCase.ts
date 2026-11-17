import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { ISaverGroupRepository } from '../../domain/contracts/ISaverGroupRepository';
import type { ISaverSessionReader } from '../../domain/contracts/ISaverSessionReader';
import type { SaverExtractionItemStatus } from '../../domain/enums/SaverEnums';
import {
  saverGroupUnselectableReason,
  type SaverGroupKind,
  type SaverGroupUnselectableReason,
} from '../../domain/services/saverGroupKind';
import { assertCanSaver, type SaverActor } from './saverActor';
import { bareGroupJid, requireSaverSession } from './saverSessionAccess';

/** Só o que o Saver usa do engine para listar grupos. */
export type SaverGroupListingEngine = Pick<IMessagingEngine, 'listParticipatingGroups'>;

export interface SaverSessionGroupDTO {
  groupJid: string;
  name: string | null;
  /** Já salvo (e não removido) pelo tenant. */
  saved: boolean;
  savedGroupId: string | null;
  lastScannedAt: Date | null;
  lastScanStatus: SaverExtractionItemStatus | null;
  /** Total de membros vindo da listagem; null = desconhecido. */
  memberCount: number | null;
  kind: SaverGroupKind;
  /** false = não pode ser pedido para leitura (motivo em `unselectableReason`). */
  selectable: boolean;
  unselectableReason: SaverGroupUnselectableReason | null;
}

export interface ListSaverSessionGroupsDeps {
  sessions: ISaverSessionReader;
  groups: Pick<ISaverGroupRepository, 'findByJids'>;
  /** Resolvido a cada chamada (engine ativa do processo). */
  engine: () => SaverGroupListingEngine;
}

/** Grupos de uma sessão WhatsApp conectada do tenant, com marca de "já salvo" e última leitura (SAVER-06..08). */
export class ListSaverSessionGroupsUseCase {
  constructor(private readonly deps: ListSaverSessionGroupsDeps) {}

  async execute(actor: SaverActor, input: { sessionId: string }): Promise<SaverSessionGroupDTO[]> {
    assertCanSaver(actor, 'view');
    const session = await requireSaverSession(this.deps.sessions, actor.tenantId, input.sessionId);
    const live = await this.deps.engine().listParticipatingGroups(session.id);
    const jids = [...new Set(live.map((g) => bareGroupJid(g.groupJid)))];
    const saved = new Map(
      (await this.deps.groups.findByJids(actor.tenantId, jids))
        .filter((g) => g.removedAt === null)
        .map((g) => [g.groupJid, g]),
    );
    const seen = new Set<string>();
    const out: SaverSessionGroupDTO[] = [];
    for (const g of live) {
      const jid = bareGroupJid(g.groupJid);
      if (seen.has(jid)) continue;
      seen.add(jid);
      const s = saved.get(jid);
      const kind = g.kind ?? 'GROUP';
      const unselectableReason = saverGroupUnselectableReason(kind);
      out.push({
        groupJid: jid,
        name: g.name ?? s?.name ?? null,
        saved: !!s,
        savedGroupId: s?.id ?? null,
        lastScannedAt: s?.lastScannedAt ?? null,
        lastScanStatus: s?.lastScanStatus ?? null,
        memberCount: typeof g.memberCount === 'number' ? g.memberCount : null,
        kind,
        selectable: unselectableReason === null,
        unselectableReason,
      });
    }
    return out;
  }
}
