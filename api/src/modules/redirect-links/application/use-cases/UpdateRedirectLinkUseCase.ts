import type { IRedirectLinkRepository } from '../../domain/contracts/IRedirectLinkRepository';
import type { RedirectLink } from '../../domain/entities/RedirectLink';
import {
  RedirectLinkNotFoundError,
  RedirectLinkSlugTakenError,
} from '../../../../shared/errors/internal/RedirectLinkErrors';
import { buildRedirectLinkData, type RedirectLinkFields } from './redirectLinkInput';

export type UpdateRedirectLinkCommand = RedirectLinkFields & { id: string };

/**
 * Edita qualquer campo, inclusive o slug: o antigo deixa de responder na hora (sem alias).
 * Contadores não mudam aqui.
 */
export class UpdateRedirectLinkUseCase {
  constructor(
    private readonly links: IRedirectLinkRepository,
    private readonly platformHosts: readonly string[],
  ) {}

  async execute({ id, ...fields }: UpdateRedirectLinkCommand): Promise<RedirectLink> {
    const current = await this.links.findById(id);
    if (!current) throw new RedirectLinkNotFoundError();
    const data = buildRedirectLinkData(fields, current, this.platformHosts);
    if (data.slug !== current.slug) {
      const other = await this.links.findBySlug(data.slug);
      if (other && other.id !== id) throw new RedirectLinkSlugTakenError();
    }
    return this.links.update(id, data);
  }
}
