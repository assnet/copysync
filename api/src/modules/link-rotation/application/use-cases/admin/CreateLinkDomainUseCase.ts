import type { ILinkDomainRepository } from '../../../domain/contracts/ILinkDomainRepository';
import type { LinkDomain } from '../../../domain/entities/LinkDomain';
import { LinkDomainInvalidError, LinkDomainTakenError } from '../../../../../shared/errors/internal/LinkRotationErrors';
import { isPlatformHostname, parseHostname, parseLandingUrl, parseReservedNames } from './linkDomainRules';

export interface CreateLinkDomainCommand {
  hostname: string;
  /** Opcional: o apex responde 404 da marca até o super-admin cadastrar (context.md #14). */
  landingUrl?: string | null;
  reservedNames?: string[];
}

/** Super-admin cadastra domínio base (ex.: copysync.com.br). `platformHosts` = painel/API, recusados. */
export class CreateLinkDomainUseCase {
  constructor(
    private readonly domains: ILinkDomainRepository,
    private readonly platformHosts: readonly string[],
  ) {}

  async execute(cmd: CreateLinkDomainCommand): Promise<LinkDomain> {
    const hostname = parseHostname(cmd.hostname);
    if (!hostname) throw new LinkDomainInvalidError('Invalid hostname');
    if (isPlatformHostname(hostname, this.platformHosts)) {
      throw new LinkDomainInvalidError('Hostname belongs to the platform');
    }
    const landingUrl = parseLandingUrl(cmd.landingUrl);
    if (landingUrl === undefined) throw new LinkDomainInvalidError('Invalid landing URL');
    const reservedNames = parseReservedNames(cmd.reservedNames);
    if (!reservedNames) throw new LinkDomainInvalidError('Invalid reserved names');
    if (await this.domains.findByHostname(hostname)) throw new LinkDomainTakenError(hostname);
    return this.domains.create({ hostname, landingUrl, reservedNames });
  }
}
