import { limitKeyOfChannel } from '../../../tenants/domain/channelLimits';
import { LinkRotationStrategy, PublicSlugKind } from '../../domain/enums/LinkRotationEnums';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { SessionNotFoundError } from '../../../../shared/errors/internal/SessionErrors';
import { type CreateLinkRotationDTO, type LinkRotationOutputDTO, toLinkRotationDTO } from '../dtos/LinkRotationDTO';
import { normalizeTitle, requireActiveDomain, requireAvailableSlug, withSlugSuggestions } from './linkRotationRules';
import type { LinkRotationUseCaseDeps } from './linkRotationUseCaseDeps';

type Deps = Pick<LinkRotationUseCaseDeps, 'rotations' | 'slugs' | 'runInSlugTransaction' | 'domains' | 'sessions' | 'entitlements'>;

/**
 * Cria o rodízio. Ordem: sessão do tenant → limite de rodízios do canal da sessão
 * (`link_rotations` no WhatsApp, `telegram_link_rotations` no Telegram; conta as rotações do
 * tenant nesse canal, inclusive pausadas) → domínio ACTIVE → slug (formato, reservado, livre) → grava
 * rodízio + claim do nome na mesma transação.
 */
export class CreateLinkRotationUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateLinkRotationDTO): Promise<LinkRotationOutputDTO> {
    const { rotations, slugs, domains, sessions, entitlements } = this.deps;
    const { tenantId } = input;

    const session = await sessions.findById(tenantId, input.sessionId);
    if (!session) throw new SessionNotFoundError(input.sessionId);

    const key = limitKeyOfChannel('linkRotations', session.channel);
    const [limit, count] = await Promise.all([
      entitlements.getNumber(tenantId, key),
      rotations.countByChannel(tenantId, session.channel),
    ]);
    if (limit !== null && count >= limit) throw new PlanLimitReachedError(key, limit);

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
