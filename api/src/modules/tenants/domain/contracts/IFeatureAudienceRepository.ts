import type { FeatureAudienceKey, FeatureAudienceSettings } from '../featureAudience';

/** `platform_settings["feature_audience"]`. */
export interface IFeatureAudienceRepository {
  /** Chaves gravadas (sem linha = `{}`). */
  get(): Promise<FeatureAudienceSettings>;
  /** Grava uma chave sem apagar as outras (merge atômico no banco). */
  set(key: FeatureAudienceKey, superAdminOnly: boolean, actorUserId: string): Promise<void>;
}

/** Leitura efetiva (gravado ou valor inicial), a cada uso: sem cache em memória. */
export interface IFeatureAudienceReader {
  superAdminOnly(key: FeatureAudienceKey): Promise<boolean>;
}
