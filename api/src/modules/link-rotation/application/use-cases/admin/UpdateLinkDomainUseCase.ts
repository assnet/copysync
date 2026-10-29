import type { ILinkDomainRepository, UpdateLinkDomainInput } from '../../../domain/contracts/ILinkDomainRepository';
import type { LinkDomain } from '../../../domain/entities/LinkDomain';
import type { LinkDomainStatus } from '../../../domain/enums/LinkRotationEnums';
import { LinkDomainInvalidError } from '../../../../../shared/errors/internal/LinkRotationErrors';
import { NotFoundError } from '../../../../../shared/errors/internal/ResourceErrors';
import { parseLandingUrl, parseReservedNames } from './linkDomainRules';

/** Hostname não muda (rotações e certificado dependem dele): troca = excluir e cadastrar. */
export interface UpdateLinkDomainCommand {
  id: string;
  status?: LinkDomainStatus;
  /** `null` ou vazio remove a landing; ausente mantém. */
  landingUrl?: string | null;
  reservedNames?: string[];
}

export class UpdateLinkDomainUseCase {
  constructor(private readonly domains: ILinkDomainRepository) {}

  async execute(cmd: UpdateLinkDomainCommand): Promise<LinkDomain> {
    const patch: UpdateLinkDomainInput = {};
    if (cmd.status !== undefined) patch.status = cmd.status;
    if (cmd.landingUrl !== undefined) {
      const landingUrl = parseLandingUrl(cmd.landingUrl);
      if (landingUrl === undefined) throw new LinkDomainInvalidError('Invalid landing URL');
      patch.landingUrl = landingUrl;
    }
    if (cmd.reservedNames !== undefined) {
      const reservedNames = parseReservedNames(cmd.reservedNames);
      if (!reservedNames) throw new LinkDomainInvalidError('Invalid reserved names');
      patch.reservedNames = reservedNames;
    }
    if (!(await this.domains.findById(cmd.id))) throw new NotFoundError('LinkDomain', cmd.id);
    return this.domains.update(cmd.id, patch);
  }
}
