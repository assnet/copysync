import type { IPublicSlugRegistry } from '../../../link-rotation/domain/contracts/IPublicSlugRegistry';
import { PublicSlugKind } from '../../../link-rotation/domain/enums/LinkRotationEnums';
import type { SlugAvailability } from '../../../link-rotation/domain/services/decideSlugAvailability';
import {
  LinkSlugInvalidError,
  LinkSlugReservedError,
  LinkSlugTakenError,
} from '../../../../shared/errors/internal/LinkRotationErrors';
import { StorefrontSlugPremiumError } from '../../../../shared/errors/internal/StorefrontErrors';

type SlugReader = Pick<IPublicSlugRegistry, 'check' | 'suggest'>;

/** Resposta do painel: o `owner` do registry não sai (diz qual recurso do tenant usa o nome). */
export type StorefrontSlugAvailability = Omit<SlugAvailability, 'owner'>;

/**
 * Lê o nome do ponto de vista da página: `OWNED` só quando o claim é **desta** página; nome de
 * rodízio do próprio tenant é `TAKEN` (o nome já está em uso), com sugestões.
 */
export async function checkStorefrontSlug(
  slugs: SlugReader,
  tenantId: string,
  domainId: string,
  raw: string,
  pageId: string | null,
): Promise<StorefrontSlugAvailability> {
  const { owner, ...result } = await slugs.check(tenantId, domainId, raw);
  if (result.status !== 'OWNED') return result;
  if (pageId && owner?.kind === PublicSlugKind.STOREFRONT && owner.ownerId === pageId) return { ...result, suggestions: [] };
  const suggestions = result.suggestions.length ? result.suggestions : await slugs.suggest(tenantId, domainId, result.slug);
  return { ...result, status: 'TAKEN', suggestions };
}

/**
 * Nome aceito para gravar (AVAILABLE ou OWNED da página) → slug normalizado; senão o erro do
 * namespace (design §5). Reserva de 30 dias de outro tenant → TAKEN, como no rodízio.
 */
export function requireStorefrontSlug(result: StorefrontSlugAvailability): string {
  switch (result.status) {
    case 'AVAILABLE':
    case 'OWNED':
      return result.slug;
    case 'INVALID':
      throw new LinkSlugInvalidError();
    case 'PREMIUM':
      throw new StorefrontSlugPremiumError(result.slug);
    case 'RESERVED':
      if (result.reservedReason === 'NAME') throw new LinkSlugReservedError(result.slug);
      throw new LinkSlugTakenError(result.suggestions);
    case 'TAKEN':
      throw new LinkSlugTakenError(result.suggestions);
  }
}
