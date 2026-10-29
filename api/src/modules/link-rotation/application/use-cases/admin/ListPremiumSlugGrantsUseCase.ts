import type { ILinkDomainRepository } from '../../../domain/contracts/ILinkDomainRepository';
import type { IPremiumSlugGrantRepository } from '../../../domain/contracts/IPremiumSlugGrantRepository';
import type { PremiumSlugGrant } from '../../../domain/entities/PremiumSlugGrant';
import { NotFoundError } from '../../../../../shared/errors/internal/ResourceErrors';

/** Super-admin: liberações de nome premium do domínio. */
export class ListPremiumSlugGrantsUseCase {
  constructor(
    private readonly domains: ILinkDomainRepository,
    private readonly grants: IPremiumSlugGrantRepository,
  ) {}

  async execute(domainId: string): Promise<PremiumSlugGrant[]> {
    if (!(await this.domains.findById(domainId))) throw new NotFoundError('LinkDomain', domainId);
    return this.grants.listByDomain(domainId);
  }
}
