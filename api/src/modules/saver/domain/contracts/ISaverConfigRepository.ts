import type { SaverConfig } from '../entities/SaverEntities';

export type SaverConfigUpdate = Partial<Omit<SaverConfig, 'tenantId' | 'updatedAt'>>;

export interface ISaverConfigRepository {
  /** Sem linha = `null` (o use case aplica os padrões). */
  findByTenant(tenantId: string): Promise<SaverConfig | null>;
  upsert(tenantId: string, update: SaverConfigUpdate): Promise<SaverConfig>;
}
