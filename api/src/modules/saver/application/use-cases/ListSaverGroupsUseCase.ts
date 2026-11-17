import type { ISaverGroupRepository } from '../../domain/contracts/ISaverGroupRepository';
import type { SaverExtractionItemStatus } from '../../domain/enums/SaverEnums';
import { assertCanSaver, type SaverActor } from './saverActor';

/** Grupo salvo como o painel vê: só contagens, nunca linha de contato. */
export interface SaverGroupDTO {
  id: string;
  groupJid: string;
  name: string;
  sessionId: string | null;
  memberCount: number;
  phoneCount: number;
  lidOnlyCount: number;
  lastScannedAt: Date | null;
  lastScanStatus: SaverExtractionItemStatus | null;
  createdAt: Date;
}

/** Grupos salvos (não removidos) do tenant com contagens e última leitura. */
export class ListSaverGroupsUseCase {
  constructor(private readonly deps: { groups: Pick<ISaverGroupRepository, 'listActive'> }) {}

  async execute(actor: SaverActor): Promise<SaverGroupDTO[]> {
    assertCanSaver(actor, 'view');
    const rows = await this.deps.groups.listActive(actor.tenantId);
    return rows.map((g) => ({
      id: g.id,
      groupJid: g.groupJid,
      name: g.name,
      sessionId: g.sessionId,
      memberCount: g.memberCount,
      phoneCount: g.phoneCount,
      lidOnlyCount: g.lidOnlyCount,
      lastScannedAt: g.lastScannedAt,
      lastScanStatus: g.lastScanStatus,
      createdAt: g.createdAt,
    }));
  }
}
