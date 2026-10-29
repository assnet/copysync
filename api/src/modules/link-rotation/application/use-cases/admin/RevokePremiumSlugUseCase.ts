import type { IAuditLogRepository } from '../../../../../shared/audit/IAuditLogRepository';
import type { IPremiumSlugGrantRepository } from '../../../domain/contracts/IPremiumSlugGrantRepository';
import { NotFoundError } from '../../../../../shared/errors/internal/ResourceErrors';

/**
 * Super-admin revoga a liberação. Página que já usa o nome continua com o claim (não derruba link
 * no ar); o nome volta a `PREMIUM` para quem não o tem. Grava AuditLog.
 */
export class RevokePremiumSlugUseCase {
  constructor(
    private readonly grants: IPremiumSlugGrantRepository,
    private readonly audit: IAuditLogRepository,
  ) {}

  async execute(cmd: { domainId: string; grantId: string; actorUserId: string }): Promise<void> {
    const grant = await this.grants.findById(cmd.domainId, cmd.grantId);
    if (!grant) throw new NotFoundError('PremiumSlugGrant', cmd.grantId);
    await this.grants.delete(cmd.domainId, cmd.grantId);
    await this.audit.create({
      tenantId: grant.tenantId,
      userId: cmd.actorUserId,
      action: 'PREMIUM_SLUG_REVOKED',
      meta: { grantId: grant.id, domainId: grant.domainId, slug: grant.slug, source: grant.source },
    });
  }
}
