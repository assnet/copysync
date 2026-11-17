import type { SaverGroup } from '../entities/SaverEntities';

/** Grupos salvos do tenant. Todo método filtra `tenantId`; removidos (`removedAt`) ficam fora salvo indicação. */
export interface ISaverGroupRepository {
  listActive(tenantId: string): Promise<SaverGroup[]>;
  findById(tenantId: string, groupId: string): Promise<SaverGroup | null>;
  findByJids(tenantId: string, groupJids: readonly string[]): Promise<SaverGroup[]>;
  /** Grupos não removidos (limite `saver_groups`). */
  countActive(tenantId: string): Promise<number>;
  /** Remoção lógica: `removedAt = at`. Nunca `DELETE`. */
  markRemoved(tenantId: string, groupId: string, at: Date): Promise<void>;
}
