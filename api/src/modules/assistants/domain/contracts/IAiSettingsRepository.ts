import type { AiSettings } from '../entities/AiSettings';

export interface IAiSettingsRepository {
  /** Chave ausente = true. */
  get(): Promise<AiSettings>;
  save(settings: AiSettings, updatedById: string): Promise<AiSettings>;
}
