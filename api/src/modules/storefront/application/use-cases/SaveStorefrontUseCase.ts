import type { Storefront, StorefrontAddress } from '../../domain/entities/Storefront';
import { validateStorefrontConfig } from '../../domain/services/storefrontRules';
import { PublicSlugKind } from '../../../link-rotation/domain/enums/LinkRotationEnums';
import { requireActiveDomain } from '../../../link-rotation/application/use-cases/linkRotationRules';
import { SLUG_RESERVATION_MS } from '../../../link-rotation/application/use-cases/linkRotationUseCaseDeps';
import { LinkSlugReservedError, LinkSlugTakenError } from '../../../../shared/errors/internal/LinkRotationErrors';
import { StorefrontSlugPremiumError } from '../../../../shared/errors/internal/StorefrontErrors';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import { requireStorefrontEnabled, type StorefrontUseCaseDeps } from './storefrontUseCaseDeps';
import { checkStorefrontSlug, requireStorefrontSlug } from './storefrontSlugRules';

type Deps = Pick<StorefrontUseCaseDeps, 'storefronts' | 'entitlements' | 'domains' | 'slugs' | 'runInSlugTransaction' | 'now'>;

/** Form da página. Sem `status` (o plano decide) e sem imagens (rotas próprias). */
export interface SaveStorefrontDTO {
  tenantId: string;
  /** Domínio ACTIVE escolhido no painel. */
  domainId: string;
  slug: string;
  title: string;
  subtitle?: string | null;
  colorPrimary: string;
  colorBackground: string;
  colorCard: string;
  categories: readonly string[];
}

/**
 * Cria ou atualiza a página. Ordem: gate → config (`validateStorefrontConfig`) → domínio ACTIVE →
 * nome (`check`, do ponto de vista da página) → transação: cria + claim STOREFRONT, ou move (se
 * domínio/nome mudou; reserva o antigo 30 dias) + update + limpa categoria órfã das ofertas.
 *
 * Erros do registry dentro da tx (corrida): `LinkSlugTakenError([])` (unique/reserva relida) e
 * `LinkSlugReservedError` (premium sem grant relido — o registry só lança RESERVED por premium na
 * escrita). Postgres aborta o tx, então são traduzidos FORA dele: TAKEN ganha sugestões e RESERVED
 * vira `STOREFRONT_SLUG_PREMIUM`.
 */
export class SaveStorefrontUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: SaveStorefrontDTO): Promise<Storefront> {
    const { tenantId } = input;
    await requireStorefrontEnabled(this.deps.entitlements, tenantId);

    const validation = validateStorefrontConfig(input);
    if (validation.kind === 'invalid') throw new ValidationError('Invalid storefront config', { field: validation.field });
    const config = validation.value;

    const domain = await requireActiveDomain(this.deps.domains, input.domainId);
    const page = await this.deps.storefronts.findByTenant(tenantId);
    const slug = requireStorefrontSlug(
      await checkStorefrontSlug(this.deps.slugs, tenantId, domain.id, input.slug, page?.id ?? null),
    );
    const address: StorefrontAddress = { domainId: domain.id, slug };
    const now = this.deps.now?.() ?? new Date();

    try {
      return await this.deps.runInSlugTransaction(async (tx) => {
        if (!page) {
          const created = await tx.storefronts.create({ tenantId, ...config });
          await tx.slugs.claim({ tenantId, ...address, kind: PublicSlugKind.STOREFRONT, ownerId: created.id });
          return { ...created, address };
        }
        const owner = { tenantId, kind: PublicSlugKind.STOREFRONT, ownerId: page.id };
        if (!page.address) {
          // Janela inconsistente (claim ausente): grava o claim em vez de mover.
          await tx.slugs.claim({ ...owner, ...address });
        } else if (page.address.domainId !== domain.id || page.address.slug !== slug) {
          await tx.slugs.move({
            ...owner, newDomainId: domain.id, newSlug: slug, reserveUntil: new Date(now.getTime() + SLUG_RESERVATION_MS),
          });
        }
        const updated = await tx.storefronts.update(tenantId, config);
        await tx.offers.clearCategoriesNotIn(tenantId, page.id, config.categories);
        return { ...updated, address };
      });
    } catch (err) {
      if (err instanceof LinkSlugTakenError) {
        throw new LinkSlugTakenError(await this.deps.slugs.suggest(tenantId, domain.id, slug));
      }
      if (err instanceof LinkSlugReservedError) throw new StorefrontSlugPremiumError(slug);
      throw err;
    }
  }
}
