import type { ILinkDomainRepository } from '../../../domain/contracts/ILinkDomainRepository';
import { LinkDomainInUseError } from '../../../../../shared/errors/internal/LinkRotationErrors';
import { NotFoundError } from '../../../../../shared/errors/internal/ResourceErrors';

/**
 * Recusa (409) enquanto houver rotação, claim de nome (rodízio/página) ou grant premium no domínio;
 * o FK `Restrict` é a segunda barreira (sem a contagem viraria P2003 cru).
 */
export class DeleteLinkDomainUseCase {
  constructor(private readonly domains: ILinkDomainRepository) {}

  async execute(id: string): Promise<void> {
    if (!(await this.domains.findById(id))) throw new NotFoundError('LinkDomain', id);
    const [rotations, slugUsage] = await Promise.all([this.domains.countRotations(id), this.domains.countSlugUsage(id)]);
    if (rotations + slugUsage > 0) throw new LinkDomainInUseError(id);
    await this.domains.delete(id);
  }
}
