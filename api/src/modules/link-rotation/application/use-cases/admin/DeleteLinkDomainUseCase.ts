import type { ILinkDomainRepository } from '../../../domain/contracts/ILinkDomainRepository';
import { LinkDomainInUseError } from '../../../../../shared/errors/internal/LinkRotationErrors';
import { NotFoundError } from '../../../../../shared/errors/internal/ResourceErrors';

/** Recusa (409) enquanto houver rotação no domínio; o FK `Restrict` é a segunda barreira. */
export class DeleteLinkDomainUseCase {
  constructor(private readonly domains: ILinkDomainRepository) {}

  async execute(id: string): Promise<void> {
    if (!(await this.domains.findById(id))) throw new NotFoundError('LinkDomain', id);
    if ((await this.domains.countRotations(id)) > 0) throw new LinkDomainInUseError(id);
    await this.domains.delete(id);
  }
}
