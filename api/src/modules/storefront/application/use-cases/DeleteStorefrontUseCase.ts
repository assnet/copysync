import { PublicSlugKind } from '../../../link-rotation/domain/enums/LinkRotationEnums';
import { ForbiddenError } from '../../../../shared/errors/internal/AuthErrors';
import { logger } from '../../../../shared/logger/logger';
import { canDeleteStorefront } from '../../domain/services/storefrontRules';
import { requireStorefront, type StorefrontUseCaseDeps } from './storefrontUseCaseDeps';

type Deps = Pick<StorefrontUseCaseDeps, 'storefronts' | 'media' | 'runInSlugTransaction' | 'confirmPassword'>;

export interface DeleteStorefrontDTO {
  tenantId: string;
  /** Usuário logado: é a senha DELE que é conferida (super admin usa a própria). */
  userId: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR';
  isSuperAdmin: boolean;
  password: string;
}

/** Remoções simultâneas no storage depois do commit. */
const IMAGE_REMOVE_BATCH = 10;

/**
 * Exclui a Página de Ofertas inteira (docs/pagina-de-ofertas.md, "Excluir a página").
 * Ordem: papel (403) → página existe (404) → senha do usuário logado (401/429) → transação
 * (libera o endereço SEM reserva, apaga a página com as ofertas em cascade, audita) → depois do
 * commit, apaga as imagens do storage. Não exige `storefront_enabled`: vale com a página pausada
 * pelo plano. A senha só passa para `confirmPassword`; nunca vai para log nem auditoria.
 */
export class DeleteStorefrontUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: DeleteStorefrontDTO): Promise<void> {
    const { storefronts, confirmPassword } = this.deps;
    const { tenantId, userId, isSuperAdmin } = input;

    if (!canDeleteStorefront(input.role, isSuperAdmin)) throw new ForbiddenError('Only tenant admins can delete the storefront');
    await requireStorefront(storefronts, tenantId);
    await confirmPassword.execute({ userId, password: input.password, action: 'STOREFRONT_DELETE' });

    const images = await this.deps.runInSlugTransaction(async (tx) => {
      // Relido no tx: é o estado que será apagado (imagens trocadas entre a checagem e aqui).
      const page = await requireStorefront(tx.storefronts, tenantId);
      const offers = await tx.offers.listByStorefront(tenantId, page.id);
      const urls = [page.avatarUrl, page.coverUrl, ...offers.map((o) => o.imageUrl)].filter((u): u is string => !!u);
      await tx.slugs.releaseWithoutReservation({ tenantId, kind: PublicSlugKind.STOREFRONT, ownerId: page.id });
      await tx.storefronts.delete(tenantId);
      await tx.audit.create({
        tenantId,
        userId,
        action: 'STOREFRONT_DELETED',
        meta: {
          slug: page.address?.slug ?? null,
          domainId: page.address?.domainId ?? null,
          offers: offers.length,
          bySuperAdmin: isSuperAdmin,
        },
      });
      return [...new Set(urls)];
    });

    await this.removeImages(tenantId, images);
  }

  /** Best effort: a página já não existe; falha vira só contagem no log (sem nome de arquivo). */
  private async removeImages(tenantId: string, urls: string[]): Promise<void> {
    const { media } = this.deps;
    let failed = 0;
    for (let i = 0; i < urls.length; i += IMAGE_REMOVE_BATCH) {
      const results = await Promise.all(
        urls.slice(i, i + IMAGE_REMOVE_BATCH).map((url) => media.remove(url).catch(() => false)),
      );
      failed += results.filter((ok) => !ok).length;
    }
    if (failed > 0) logger.warn({ tenantId, images: urls.length, failed }, 'storefront delete: images left in storage');
    else logger.info({ tenantId, images: urls.length }, 'storefront deleted');
  }
}
