import type { IRedirectLinkRepository } from '../../domain/contracts/IRedirectLinkRepository';
import type { RedirectLink } from '../../domain/entities/RedirectLink';
import { RedirectLinkSlugTakenError } from '../../../../shared/errors/internal/RedirectLinkErrors';
import { buildRedirectLinkData, type RedirectLinkFields } from './redirectLinkInput';

export type CreateRedirectLinkCommand = RedirectLinkFields & { slug: string; urlA: string };

/** Super-admin cria link. `platformHosts` = painel/API (destino neles em `/redirect` = loop). */
export class CreateRedirectLinkUseCase {
  constructor(
    private readonly links: IRedirectLinkRepository,
    private readonly platformHosts: readonly string[],
  ) {}

  async execute(cmd: CreateRedirectLinkCommand): Promise<RedirectLink> {
    const data = buildRedirectLinkData(cmd, null, this.platformHosts);
    if (await this.links.findBySlug(data.slug)) throw new RedirectLinkSlugTakenError();
    return this.links.create(data);
  }
}
