import type { IRedirectLinkRepository } from '../../domain/contracts/IRedirectLinkRepository';
import type { RedirectLink } from '../../domain/entities/RedirectLink';

/** Todos os links da plataforma, por slug. */
export class ListRedirectLinksUseCase {
  constructor(private readonly links: IRedirectLinkRepository) {}

  execute(): Promise<RedirectLink[]> {
    return this.links.list();
  }
}
