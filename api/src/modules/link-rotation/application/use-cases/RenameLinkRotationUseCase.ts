import { LinkDomainInvalidError, LinkRotationNotFoundError } from '../../../../shared/errors/internal/LinkRotationErrors';
import { type LinkRotationOutputDTO, type RenameLinkRotationDTO, toLinkRotationDTO } from '../dtos/LinkRotationDTO';
import { normalizeSlug } from '../../domain/services/slugRules';
import { requireActiveDomain, requireAvailableSlug, withSlugSuggestions } from './linkRotationRules';
import { type LinkRotationUseCaseDeps, SLUG_RESERVATION_MS } from './linkRotationUseCaseDeps';

type Deps = Pick<LinkRotationUseCaseDeps, 'rotations' | 'domains' | 'now'>;

/**
 * Troca o nome (e opcionalmente o domínio). Mesmas regras de slug da criação; o nome antigo fica
 * reservado ao tenant por 30 dias (link antigo ainda circula). Domínio novo tem de estar ACTIVE;
 * renomear dentro do domínio atual é aceito mesmo se ele foi pausado (o link existente segue
 * servindo, então trocar o nome não cria rodízio novo no domínio).
 */
export class RenameLinkRotationUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: RenameLinkRotationDTO): Promise<LinkRotationOutputDTO> {
    const { rotations, domains } = this.deps;
    const { tenantId, rotationId } = input;
    const now = this.deps.now?.() ?? new Date();

    const current = await rotations.findById(tenantId, rotationId);
    if (!current) throw new LinkRotationNotFoundError(rotationId);

    const domainChanged = input.domainId !== undefined && input.domainId !== current.domainId;
    const domain = domainChanged
      ? await requireActiveDomain(domains, input.domainId!)
      : await domains.findById(current.domainId);
    if (!domain) throw new LinkDomainInvalidError('Link domain not available');

    if (!domainChanged && normalizeSlug(input.slug) === current.slug) return toLinkRotationDTO(current, domain);

    const slug = await requireAvailableSlug(rotations, domain, input.slug, tenantId);
    const updated = await withSlugSuggestions(
      () => rotations.update(tenantId, rotationId, { slug, ...(domainChanged && { domainId: domain.id }) }),
      rotations, domain, slug, tenantId,
    );
    await rotations.reserveSlug(current.domainId, current.slug, tenantId, new Date(now.getTime() + SLUG_RESERVATION_MS));
    return toLinkRotationDTO({ ...updated, groups: current.groups }, domain);
  }
}
