import type { PublicSlugKind } from '../enums/LinkRotationEnums';
import type { SlugAvailability } from '../services/decideSlugAvailability';

export interface ClaimPublicSlugInput {
  tenantId: string;
  domainId: string;
  /** Já normalizado (veio de `check`). */
  slug: string;
  kind: PublicSlugKind;
  ownerId: string;
}

export interface MovePublicSlugInput {
  tenantId: string;
  kind: PublicSlugKind;
  ownerId: string;
  newDomainId: string;
  newSlug: string;
  /** Validade da reserva do nome antigo (no domínio antigo). */
  reserveUntil: Date;
}

export interface ReleasePublicSlugInput {
  tenantId: string;
  kind: PublicSlugKind;
  ownerId: string;
  reserveUntil: Date;
}

/**
 * Dono único de `<slug>.<domínio>` (rodízio e página de ofertas). A porta não recebe transação:
 * a infra monta uma instância presa ao tx (`runInSlugTransaction` do container) e o dono é
 * gravado no mesmo tx de `claim`/`move`/`release`.
 *
 * Erros de escrita: nome tomado (unique ou reserva vigente de outro tenant, relida dentro do tx)
 * → `LinkSlugTakenError([])`; nome premium sem grant → `LinkSlugReservedError`. Como o Postgres
 * aborta o tx no unique, o chamador captura FORA da transação e só então pede `suggest`.
 */
export interface IPublicSlugRegistry {
  /** Só leitura; ordem em `decideSlugAvailability`. */
  check(tenantId: string, domainId: string, slug: string): Promise<SlugAvailability>;
  /** Até 5 nomes livres derivados de `slug` (uma ida ao banco por tabela). */
  suggest(tenantId: string, domainId: string, slug: string): Promise<string[]>;
  /** Apaga a reserva do próprio tenant para o nome e grava o claim. */
  claim(input: ClaimPublicSlugInput): Promise<void>;
  /** Troca domínio/slug do claim e reserva o nome antigo ao tenant. Chamar antes de gravar o dono. */
  move(input: MovePublicSlugInput): Promise<void>;
  /** Reserva o nome ao tenant e apaga o claim. Chamar antes de apagar o dono. */
  release(input: ReleasePublicSlugInput): Promise<void>;
}
