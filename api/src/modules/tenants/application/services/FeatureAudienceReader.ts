import type { IFeatureAudienceReader, IFeatureAudienceRepository } from '../../domain/contracts/IFeatureAudienceRepository';
import { FEATURE_AUDIENCE_KEYS, type FeatureAudienceKey } from '../../domain/featureAudience';

/** Valor inicial por chave (env), lido a cada chamada. */
export type FeatureAudienceDefaults = () => Record<FeatureAudienceKey, boolean>;

/**
 * Audiência efetiva: valor gravado pelo admin, senão o valor inicial (env). Lê o banco a cada uso (uma linha por
 * chave primária): sem cache por processo, então todas as réplicas veem a troca no pedido seguinte.
 */
export class FeatureAudienceReader implements IFeatureAudienceReader {
  constructor(private readonly repo: Pick<IFeatureAudienceRepository, 'get'>, private readonly defaults: FeatureAudienceDefaults) {}

  async superAdminOnly(key: FeatureAudienceKey): Promise<boolean> {
    return (await this.all())[key];
  }

  async all(): Promise<Record<FeatureAudienceKey, boolean>> {
    const saved = await this.repo.get();
    const initial = this.defaults();
    return Object.fromEntries(FEATURE_AUDIENCE_KEYS.map((k) => [k, saved[k] ?? initial[k]])) as Record<FeatureAudienceKey, boolean>;
  }
}
