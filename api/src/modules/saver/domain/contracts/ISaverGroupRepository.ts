import type { SaverGroup } from '../entities/SaverEntities';
import type { SaverExtractionItemStatus } from '../enums/SaverEnums';

export interface SaverGroupUpsertInput {
  groupJid: string;
  name: string;
}

/** Resultado de uma leitura do grupo (contadores da tela; nunca linhas de contato). */
export interface SaverGroupScanInput {
  sessionId: string;
  status: SaverExtractionItemStatus;
  at: Date;
  /** Ausentes quando a leitura falhou (contadores anteriores ficam). */
  memberCount?: number;
  phoneCount?: number;
  lidOnlyCount?: number;
}

/** Grupos salvos do tenant. Todo método filtra `tenantId`; removidos (`removedAt`) ficam fora salvo indicação. */
export interface ISaverGroupRepository {
  listActive(tenantId: string): Promise<SaverGroup[]>;
  findById(tenantId: string, groupId: string): Promise<SaverGroup | null>;
  /** Inclui removidos (`removedAt` preenchido): quem chama decide reativar ou ignorar. */
  findByJids(tenantId: string, groupJids: readonly string[]): Promise<SaverGroup[]>;
  /** Cria ou reativa (`removedAt = null`) por `(tenantId, groupJid)`; atualiza nome e sessão. */
  upsertMany(tenantId: string, sessionId: string, groups: readonly SaverGroupUpsertInput[]): Promise<SaverGroup[]>;
  recordScan(tenantId: string, groupId: string, scan: SaverGroupScanInput): Promise<void>;
  /** Grupos não removidos (limite `saver_groups`). */
  countActive(tenantId: string): Promise<number>;
  /** Remoção lógica: `removedAt = at`. Nunca `DELETE`. */
  markRemoved(tenantId: string, groupId: string, at: Date): Promise<void>;
}
