import type { IAuditLogRepository } from '../../../../../shared/audit/IAuditLogRepository';
import type { ILinkDomainRepository } from '../../../domain/contracts/ILinkDomainRepository';
import type { IPremiumSlugGrantRepository } from '../../../domain/contracts/IPremiumSlugGrantRepository';
import type { PremiumSlugGrant } from '../../../domain/entities/PremiumSlugGrant';
import { isPremiumSlug } from '../../../domain/services/decideSlugAvailability';
import { normalizeSlug } from '../../../domain/services/slugRules';
import { LinkDomainInvalidError } from '../../../../../shared/errors/internal/LinkRotationErrors';
import { NotFoundError } from '../../../../../shared/errors/internal/ResourceErrors';

export interface GrantPremiumSlugCommand {
  domainId: string;
  tenantId: string;
  slug: string;
  /** ISO; ausente/null = sem validade. Tem de estar no futuro. */
  expiresAt?: string | null;
  /** Super-admin que concedeu (AuditLog). */
  actorUserId: string;
}

/**
 * Super-admin libera um nome de `premiumNames` para um tenant (`source = MANUAL`). Um nome tem no
 * máximo um grant por domínio: já concedido → 409 `LINK_SLUG_TAKEN` (revogar antes). Grava AuditLog.
 */
export class GrantPremiumSlugUseCase {
  constructor(
    private readonly domains: ILinkDomainRepository,
    private readonly grants: IPremiumSlugGrantRepository,
    private readonly audit: IAuditLogRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(cmd: GrantPremiumSlugCommand): Promise<PremiumSlugGrant> {
    const domain = await this.domains.findById(cmd.domainId);
    if (!domain) throw new NotFoundError('LinkDomain', cmd.domainId);
    const slug = normalizeSlug(cmd.slug);
    if (!isPremiumSlug(slug, domain.premiumNames)) throw new LinkDomainInvalidError('Name is not a premium name of the domain');

    let expiresAt: Date | null = null;
    if (cmd.expiresAt) {
      expiresAt = new Date(cmd.expiresAt);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt <= this.now()) {
        throw new LinkDomainInvalidError('Expiration must be a future date');
      }
    }

    const grant = await this.grants.create({ domainId: domain.id, slug, tenantId: cmd.tenantId, source: 'MANUAL', expiresAt });
    await this.audit.create({
      tenantId: grant.tenantId,
      userId: cmd.actorUserId,
      action: 'PREMIUM_SLUG_GRANTED',
      meta: { grantId: grant.id, domainId: domain.id, hostname: domain.hostname, slug, source: grant.source, expiresAt: expiresAt?.toISOString() ?? null },
    });
    return grant;
  }
}
