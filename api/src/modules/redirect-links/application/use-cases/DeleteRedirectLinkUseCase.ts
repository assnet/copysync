import type { IRedirectLinkRepository } from '../../domain/contracts/IRedirectLinkRepository';

/** Apaga de vez (contadores juntos). Para pausar sem perder histórico, desative. */
export class DeleteRedirectLinkUseCase {
  constructor(private readonly links: IRedirectLinkRepository) {}

  execute(id: string): Promise<void> {
    return this.links.delete(id);
  }
}
