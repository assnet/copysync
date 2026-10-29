import type { LinkDomain } from '../../domain/entities/LinkDomain';
import type { IPublicSlugRegistry } from '../../domain/contracts/IPublicSlugRegistry';
import { LinkDomainStatus } from '../../domain/enums/LinkRotationEnums';
import {
  LinkDomainInvalidError,
  LinkSlugInvalidError,
  LinkSlugReservedError,
  LinkSlugTakenError,
} from '../../../../shared/errors/internal/LinkRotationErrors';
import type { LinkDomainReader } from './linkRotationUseCaseDeps';

type SlugReader = Pick<IPublicSlugRegistry, 'check' | 'suggest'>;

/** Domínio existente e ACTIVE (rodízio novo ou troca de domínio). */
export async function requireActiveDomain(domains: LinkDomainReader, domainId: string): Promise<LinkDomain> {
  const domain = await domains.findById(domainId);
  if (!domain || domain.status !== LinkDomainStatus.ACTIVE) {
    throw new LinkDomainInvalidError('Link domain not available');
  }
  return domain;
}

/**
 * Normaliza e confere o nome no namespace público (§4.1). Mapeamento do rodízio, sem contrato
 * novo: `OWNED` → TAKEN (outro link do tenant já usa); `PREMIUM` → RESERVED (nome especial é da
 * página); reserva de 30 dias de outro tenant → TAKEN (como antes). Devolve o slug normalizado.
 */
export async function requireAvailableSlug(
  slugs: SlugReader,
  domain: LinkDomain,
  raw: string,
  tenantId: string,
): Promise<string> {
  const result = await slugs.check(tenantId, domain.id, raw);
  switch (result.status) {
    case 'AVAILABLE':
      return result.slug;
    case 'INVALID':
      throw new LinkSlugInvalidError();
    case 'PREMIUM':
      throw new LinkSlugReservedError(result.slug);
    case 'RESERVED':
      if (result.reservedReason === 'NAME') throw new LinkSlugReservedError(result.slug);
      throw new LinkSlugTakenError(result.suggestions);
    case 'TAKEN':
    case 'OWNED':
      throw new LinkSlugTakenError(result.suggestions);
  }
}

/**
 * Corrida no unique (domínio, slug): o tx foi desfeito e o erro chega sem sugestões; aqui, já
 * fora da transação, elas entram. `run` deve envolver o `runInSlugTransaction` inteiro.
 */
export async function withSlugSuggestions<T>(
  run: () => Promise<T>,
  slugs: SlugReader,
  domain: LinkDomain,
  slug: string,
  tenantId: string,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof LinkSlugTakenError) throw new LinkSlugTakenError(await slugs.suggest(tenantId, domain.id, slug));
    throw err;
  }
}

export const TITLE_MAX_LENGTH = 80;

/** Título vazio vira null; acima de 80 é recusado pelo schema da rota e cortado aqui por segurança. */
export function normalizeTitle(title: string | null | undefined): string | null | undefined {
  if (title === undefined) return undefined;
  const t = title?.trim() ?? '';
  return t ? t.slice(0, TITLE_MAX_LENGTH) : null;
}
