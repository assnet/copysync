import type { LinkDomain } from '../../domain/entities/LinkDomain';
import type { ILinkRotationRepository } from '../../domain/contracts/ILinkRotationRepository';
import { LinkDomainStatus } from '../../domain/enums/LinkRotationEnums';
import { MAX_SLUG_SUGGESTIONS, suggestSlugs, validateSlug } from '../../domain/services/slugRules';
import {
  LinkDomainInvalidError,
  LinkSlugInvalidError,
  LinkSlugReservedError,
  LinkSlugTakenError,
} from '../../../../shared/errors/internal/LinkRotationErrors';
import type { LinkDomainReader } from './linkRotationUseCaseDeps';

/** Candidatas checadas de uma vez no banco; as primeiras livres viram sugestão. */
const SUGGESTION_POOL = 30;

type SlugRepo = Pick<ILinkRotationRepository, 'isSlugAvailable' | 'findUnavailableSlugs'>;

/** Domínio existente e ACTIVE (rodízio novo ou troca de domínio). */
export async function requireActiveDomain(domains: LinkDomainReader, domainId: string): Promise<LinkDomain> {
  const domain = await domains.findById(domainId);
  if (!domain || domain.status !== LinkDomainStatus.ACTIVE) {
    throw new LinkDomainInvalidError('Link domain not available');
  }
  return domain;
}

/** `LinkSlugTakenError` com até 5 nomes livres (uma consulta para todas as candidatas). */
export async function slugTakenError(
  rotations: SlugRepo,
  domain: LinkDomain,
  slug: string,
  tenantId: string,
): Promise<LinkSlugTakenError> {
  const pool = suggestSlugs(slug, { extraReserved: domain.reservedNames, limit: SUGGESTION_POOL });
  const taken = new Set(await rotations.findUnavailableSlugs(domain.id, pool, tenantId));
  return new LinkSlugTakenError(pool.filter((s) => !taken.has(s)).slice(0, MAX_SLUG_SUGGESTIONS));
}

/** Normaliza, valida (formato/reservado) e confere disponibilidade. Devolve o slug normalizado. */
export async function requireAvailableSlug(
  rotations: SlugRepo,
  domain: LinkDomain,
  raw: string,
  tenantId: string,
): Promise<string> {
  const result = validateSlug(raw, domain.reservedNames);
  if (result.kind === 'invalid') throw new LinkSlugInvalidError();
  if (result.kind === 'reserved') throw new LinkSlugReservedError(result.slug);
  if (!(await rotations.isSlugAvailable(domain.id, result.slug, tenantId))) {
    throw await slugTakenError(rotations, domain, result.slug, tenantId);
  }
  return result.slug;
}

/** Corrida no unique (domínio, slug): repositório lança sem sugestões; aqui elas entram. */
export async function withSlugSuggestions<T>(
  run: () => Promise<T>,
  rotations: SlugRepo,
  domain: LinkDomain,
  slug: string,
  tenantId: string,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof LinkSlugTakenError) throw await slugTakenError(rotations, domain, slug, tenantId);
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
