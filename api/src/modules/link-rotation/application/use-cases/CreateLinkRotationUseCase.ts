import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { LinkRotationStrategy } from '../../domain/enums/LinkRotationEnums';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { SessionNotFoundError } from '../../../../shared/errors/internal/SessionErrors';
import { type CreateLinkRotationDTO, type LinkRotationOutputDTO, toLinkRotationDTO } from '../dtos/LinkRotationDTO';
import { normalizeTitle, requireActiveDomain, requireAvailableSlug, withSlugSuggestions } from './linkRotationRules';
import type { LinkRotationUseCaseDeps } from './linkRotationUseCaseDeps';

type Deps = Pick<LinkRotationUseCaseDeps, 'rotations' | 'domains' | 'sessions' | 'entitlements'>;

/**
 * Cria o rodízio. Ordem: limite `link_rotations` (conta todas as rotações do tenant, inclusive
 * pausadas) → sessão do tenant → domínio ACTIVE → slug (formato, reservado, livre) → grava.
 */
export class CreateLinkRotationUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateLinkRotationDTO): Promise<LinkRotationOutputDTO> {
    const { rotations, domains, sessions, entitlements } = this.deps;
    const { tenantId } = input;

    const [limit, count] = await Promise.all([
      entitlements.getNumber(tenantId, ENTITLEMENT_KEYS.LINK_ROTATIONS),
      rotations.countByTenant(tenantId),
    ]);
    if (limit !== null && count >= limit) throw new PlanLimitReachedError(ENTITLEMENT_KEYS.LINK_ROTATIONS, limit);

    const session = await sessions.findById(tenantId, input.sessionId);
    if (!session) throw new SessionNotFoundError(input.sessionId);

    const domain = await requireActiveDomain(domains, input.domainId);
    const slug = await requireAvailableSlug(rotations, domain, input.slug, tenantId);

    const created = await withSlugSuggestions(
      () => rotations.create({
        tenantId,
        sessionId: session.id,
        domainId: domain.id,
        slug,
        strategy: input.strategy ?? LinkRotationStrategy.BALANCED,
        title: normalizeTitle(input.title) ?? null,
      }),
      rotations, domain, slug, tenantId,
    );
    return toLinkRotationDTO({ ...created, groups: [] }, domain);
  }
}
