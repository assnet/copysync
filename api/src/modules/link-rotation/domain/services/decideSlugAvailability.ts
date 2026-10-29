import type { PublicSlugKind } from '../enums/LinkRotationEnums';
import { normalizeSlug, validateSlug } from './slugRules';

/**
 * Disponibilidade de `<slug>.<domínio>` no namespace público (rodízio + página de ofertas).
 * Função pura: o repositório só lê os fatos, a ordem de decisão mora aqui (design §4.1).
 */

export type SlugAvailabilityStatus = 'INVALID' | 'RESERVED' | 'PREMIUM' | 'TAKEN' | 'OWNED' | 'AVAILABLE';

/**
 * Por que `RESERVED`: nome bloqueado pelo domínio (`NAME`) ou nome que outro tenant largou há
 * menos de 30 dias (`RECENT_RELEASE`).
 * SPEC_DEVIATION: §4.1 só lista `RESERVED`. Reason: o rodízio responde `LINK_SLUG_TAKEN` para a
 * reserva de 30 dias (teste atual) e `LINK_SLUG_RESERVED` para nome bloqueado; sem o motivo
 * o mapeamento perderia essa diferença.
 */
export type SlugReservedReason = 'NAME' | 'RECENT_RELEASE';

export interface SlugOwner {
  kind: PublicSlugKind;
  ownerId: string;
}

export interface SlugDecision {
  status: SlugAvailabilityStatus;
  /** Sempre o normalizado. */
  slug: string;
  /** Só em `RESERVED`. */
  reservedReason?: SlugReservedReason;
  /** Só em `OWNED`: qual recurso do próprio tenant já usa o nome. */
  owner?: SlugOwner;
}

export interface SlugAvailability extends SlugDecision {
  /** Até 5 nomes livres quando o pedido não está livre (vazio em `INVALID`/`AVAILABLE`). */
  suggestions: string[];
}

/** O que o banco sabe sobre (domínio, slug). Tudo `null`/`false` = nada gravado. */
export interface SlugFacts {
  claim: { tenantId: string; kind: PublicSlugKind; ownerId: string } | null;
  /** Linha em `link_rotations` sem claim (rede da janela de deploy). */
  unclaimedRotation: boolean;
  reservation: { tenantId: string; expiresAt: Date } | null;
  grant: { tenantId: string; expiresAt: Date | null } | null;
}

export interface DecideSlugInput {
  raw: string;
  tenantId: string;
  reservedNames: readonly string[];
  premiumNames: readonly string[];
  facts: SlugFacts;
  now: Date;
}

export const NO_SLUG_FACTS: SlugFacts = { claim: null, unclaimedRotation: false, reservation: null, grant: null };

export function isPremiumSlug(slug: string, premiumNames: readonly string[]): boolean {
  return premiumNames.some((name) => normalizeSlug(name) === slug);
}

/** Grant do próprio tenant e vigente (sem validade = permanente). */
export function hasActiveGrant(grant: SlugFacts['grant'], tenantId: string, now: Date): boolean {
  return !!grant && grant.tenantId === tenantId && (grant.expiresAt === null || grant.expiresAt > now);
}

/**
 * Ordem: formato → reservados (padrão + domínio) → claim (dono = tenant → OWNED, senão TAKEN) →
 * rodízio sem claim → TAKEN → reserva vigente de outro tenant → RESERVED → premium sem grant
 * do tenant → PREMIUM → AVAILABLE.
 */
export function decideSlugAvailability(input: DecideSlugInput): SlugDecision {
  const { tenantId, facts, now } = input;
  const validation = validateSlug(input.raw, input.reservedNames);
  const slug = validation.slug;
  if (validation.kind === 'invalid') return { status: 'INVALID', slug };
  if (validation.kind === 'reserved') return { status: 'RESERVED', slug, reservedReason: 'NAME' };

  if (facts.claim) {
    return facts.claim.tenantId === tenantId
      ? { status: 'OWNED', slug, owner: { kind: facts.claim.kind, ownerId: facts.claim.ownerId } }
      : { status: 'TAKEN', slug };
  }
  if (facts.unclaimedRotation) return { status: 'TAKEN', slug };

  const { reservation } = facts;
  if (reservation && reservation.tenantId !== tenantId && reservation.expiresAt > now) {
    return { status: 'RESERVED', slug, reservedReason: 'RECENT_RELEASE' };
  }
  if (isPremiumSlug(slug, input.premiumNames) && !hasActiveGrant(facts.grant, tenantId, now)) {
    return { status: 'PREMIUM', slug };
  }
  return { status: 'AVAILABLE', slug };
}
