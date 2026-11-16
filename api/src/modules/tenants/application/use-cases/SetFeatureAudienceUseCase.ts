import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import type { IFeatureAudienceRepository } from '../../domain/contracts/IFeatureAudienceRepository';
import { isFeatureAudienceKey } from '../../domain/featureAudience';

export interface SetFeatureAudienceCommand {
  key: string;
  superAdminOnly: boolean;
  /** Super admin que alterou (AuditLog). */
  actorUserId: string;
}

export interface SetFeatureAudienceResult {
  key: string;
  superAdminOnly: boolean;
}

/** Flag + auditoria no mesmo commit. */
export type FeatureAudienceTransaction = <T>(
  fn: (scope: { audience: Pick<IFeatureAudienceRepository, 'set'>; audit: IAuditLogRepository }) => Promise<T>,
) => Promise<T>;

/**
 * Super admin troca a audiência de um recurso (`PUT /admin/plan-entitlements/:key/audience`). Chave sem audiência →
 * 400 `VALIDATION_ERROR`. Audita `PLAN_ENTITLEMENT_CHANGED` com `meta.audience`. Não mexe em preset nem tenant.
 */
export class SetFeatureAudienceUseCase {
  constructor(private readonly transaction: FeatureAudienceTransaction) {}

  async execute(cmd: SetFeatureAudienceCommand): Promise<SetFeatureAudienceResult> {
    if (!isFeatureAudienceKey(cmd.key)) throw new ValidationError('Entitlement key has no audience', { key: cmd.key });
    if (typeof cmd.superAdminOnly !== 'boolean') throw new ValidationError('Invalid audience value', { key: cmd.key });
    const { key, superAdminOnly } = cmd;
    return this.transaction(async ({ audience, audit }) => {
      await audience.set(key, superAdminOnly, cmd.actorUserId);
      await audit.create({ userId: cmd.actorUserId, action: 'PLAN_ENTITLEMENT_CHANGED', meta: { key, audience: { superAdminOnly } } });
      return { key, superAdminOnly };
    });
  }
}
