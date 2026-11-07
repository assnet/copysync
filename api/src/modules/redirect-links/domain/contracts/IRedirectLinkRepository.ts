import type { RedirectLink, RedirectSide } from '../entities/RedirectLink';

export interface RedirectLinkData {
  slug: string;
  urlA: string;
  urlB: string | null;
  percentA: number;
  isActive: boolean;
  note: string | null;
}

/** Links da plataforma. Recurso global (sem tenantId): só super-admin e a rota pública. */
export interface IRedirectLinkRepository {
  list(): Promise<RedirectLink[]>;
  findById(id: string): Promise<RedirectLink | null>;
  findBySlug(slug: string): Promise<RedirectLink | null>;
  /** Slug ativo para a rota pública; inativo = null. */
  findActiveBySlug(slug: string): Promise<RedirectLink | null>;
  /** Slug repetido (corrida) → `RedirectLinkSlugTakenError`. */
  create(data: RedirectLinkData): Promise<RedirectLink>;
  /** Inexistente → `RedirectLinkNotFoundError`; slug repetido → `RedirectLinkSlugTakenError`. */
  update(id: string, data: RedirectLinkData): Promise<RedirectLink>;
  /** Inexistente → `RedirectLinkNotFoundError`. */
  delete(id: string): Promise<void>;
  /** `UPDATE … SET hits = hits + 1` atômico, sem mexer em `updatedAt`. */
  incrementHit(id: string, side: RedirectSide): Promise<void>;
}
