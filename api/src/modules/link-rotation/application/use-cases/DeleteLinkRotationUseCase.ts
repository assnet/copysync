import { LinkRotationNotFoundError } from '../../../../shared/errors/internal/LinkRotationErrors';
import { type LinkRotationUseCaseDeps, SLUG_RESERVATION_MS } from './linkRotationUseCaseDeps';

type Deps = Pick<LinkRotationUseCaseDeps, 'rotations' | 'now'>;

/** Exclui (grupos e cliques caem por cascade) e reserva o nome ao tenant por 30 dias. */
export class DeleteLinkRotationUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(tenantId: string, rotationId: string): Promise<void> {
    const { rotations } = this.deps;
    const now = this.deps.now?.() ?? new Date();
    const current = await rotations.findById(tenantId, rotationId);
    if (!current) throw new LinkRotationNotFoundError(rotationId);
    await rotations.delete(tenantId, rotationId);
    await rotations.reserveSlug(current.domainId, current.slug, tenantId, new Date(now.getTime() + SLUG_RESERVATION_MS));
  }
}
