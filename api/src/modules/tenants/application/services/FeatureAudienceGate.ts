import type { IFeatureAudienceReader } from '../../domain/contracts/IFeatureAudienceRepository';
import type { FeatureAudienceKey } from '../../domain/featureAudience';

export interface FeatureAudienceViewer {
  /** Do token (`request.user.isSuperAdmin`), não do papel no tenant. */
  isSuperAdmin: boolean;
}

/**
 * Portão genérico de audiência por chave (flag "Só super admin" em `/admin/plan-entitlements`,
 * `platform_settings.feature_audience`; nunca gravada = valor inicial). Ligada: só super admin vê; desligada: todos
 * veem (o plano/entitlement é cobrado à parte por quem usa o portão). Sem estado: lê a flag a cada chamada.
 */
export class FeatureAudienceGate {
  constructor(private readonly audience: IFeatureAudienceReader) {}

  /** Flag atual: `true` = só super admin. */
  superAdminOnly(key: FeatureAudienceKey): Promise<boolean> {
    return this.audience.superAdminOnly(key);
  }

  async isVisible(key: FeatureAudienceKey, viewer: FeatureAudienceViewer): Promise<boolean> {
    return (await this.superAdminOnly(key)) ? viewer.isSuperAdmin === true : true;
  }
}
