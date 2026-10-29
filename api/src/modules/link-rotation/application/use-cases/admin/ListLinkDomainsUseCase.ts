import type { ILinkDomainRepository } from '../../../domain/contracts/ILinkDomainRepository';
import type { LinkDomain } from '../../../domain/entities/LinkDomain';

/** Super-admin: todos os domínios de links (recurso global, sem tenant). */
export class ListLinkDomainsUseCase {
  constructor(private readonly domains: ILinkDomainRepository) {}

  execute(): Promise<LinkDomain[]> {
    return this.domains.list();
  }
}
