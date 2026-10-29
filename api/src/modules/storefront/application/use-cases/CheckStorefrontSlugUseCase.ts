import type { LinkDomain } from '../../../link-rotation/domain/entities/LinkDomain';
import { requireActiveDomain } from '../../../link-rotation/application/use-cases/linkRotationRules';
import { LinkDomainInvalidError } from '../../../../shared/errors/internal/LinkRotationErrors';
import { requireStorefrontEnabled, type StorefrontUseCaseDeps } from './storefrontUseCaseDeps';
import { checkStorefrontSlug, type StorefrontSlugAvailability } from './storefrontSlugRules';

type Deps = Pick<StorefrontUseCaseDeps, 'storefronts' | 'entitlements' | 'domains' | 'slugs'>;

export interface CheckStorefrontSlugDTO {
  tenantId: string;
  slug: string;
  /** Ausente = domínio atual da página (se ACTIVE), senão o primeiro ACTIVE. */
  domainId?: string;
}

/** Campo do nome no painel: AVAILABLE | OWNED | TAKEN | RESERVED | PREMIUM | INVALID (+ sugestões). */
export class CheckStorefrontSlugUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: CheckStorefrontSlugDTO): Promise<StorefrontSlugAvailability> {
    const { tenantId } = input;
    await requireStorefrontEnabled(this.deps.entitlements, tenantId);
    const page = await this.deps.storefronts.findByTenant(tenantId);
    const domain = input.domainId
      ? await requireActiveDomain(this.deps.domains, input.domainId)
      : await this.defaultDomain(page?.address?.domainId ?? null);
    return checkStorefrontSlug(this.deps.slugs, tenantId, domain.id, input.slug, page?.id ?? null);
  }

  private async defaultDomain(current: string | null): Promise<LinkDomain> {
    const active = await this.deps.domains.listActive();
    const domain = active.find((d) => d.id === current) ?? active[0];
    if (!domain) throw new LinkDomainInvalidError('Link domain not available');
    return domain;
  }
}
