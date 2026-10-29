import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { LinkRotationStrategy, PublicSlugKind } from '../../domain/enums/LinkRotationEnums';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { SessionNotFoundError } from '../../../../shared/errors/internal/SessionErrors';
import { type CreateLinkRotationDTO, type LinkRotationOutputDTO, toLinkRotationDTO } from '../dtos/LinkRotationDTO';
import { normalizeTitle, requireActiveDomain, requireAvailableSlug, withSlugSuggestions } from './linkRotationRules';
import type { LinkRotationUseCaseDeps } from './linkRotationUseCaseDeps';

type Deps = Pick<LinkRotationUseCaseDeps, 'rotations' | 'slugs' | 'runInSlugTransaction' | 'domains' | 'sessions' | 'entitlements'>;

/**
 * Cria o rodízio. Ordem: limite `link_rotations` (conta todas as rotações do tenant, inclusive
 * pausadas) → sessão do tenant → domínio ACTIVE → slug (formato, reservado, livre) → grava
 * rodízio + claim do nome na mesma transação.
 */
export class CreateLinkRotationUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateLinkRotationDTO): Promise<LinkRotationOutputDTO> {
    const { rotations, slugs, domains, sessions, entitlements } = this.deps;
    const { tenantId } = input;

    const [limit, count] = await Promise.all([
      entitlements.getNumber(tenantId, ENTITLEMENT_KEYS.LINK_ROTATIONS),
      rotations.countByTenant(tenantId),
    ]);
    if (limit !== null && count >= limit) throw new PlanLimitReachedError(ENTITLEMENT_KEYS.LINK_ROTATIONS, limit);

    const session = await sessions.findById(tenantId, input.sessionId);
    if (!session) throw new SessionNotFoundError(input.sessionId);

    const domain = await requireActiveDomain(domains, input.domainId);
    const slug = await requireAvailableSlug(slugs, domain, input.slug, tenantId);

    const created = await withSlugSuggestions(
      () => this.deps.runInSlugTransaction(async (tx) => {
        const rotation = await tx.rotations.create({
          tenantId,
          sessionId: session.id,
          domainId: domain.id,
          slug,
          strategy: input.strategy ?? LinkRotationStrategy.BALANCED,
          title: normalizeTitle(input.title) ?? null,
        });
        await tx.slugs.claim({ tenantId, domainId: domain.id, slug, kind: PublicSlugKind.LINK_ROTATION, ownerId: rotation.id });
        return rotation;
      }),
      slugs, domain, slug, tenantId,
    );
    return toLinkRotationDTO({ ...created, groups: [] }, domain);
  }
}
