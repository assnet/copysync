import { Prisma, type PrismaClient } from '@prisma/client';
import type { TransactionClient } from '../../../../shared/database/UnitOfWork';
import type {
  ClaimPublicSlugInput,
  IPublicSlugRegistry,
  MovePublicSlugInput,
  ReleasePublicSlugInput,
} from '../../domain/contracts/IPublicSlugRegistry';
import { PublicSlugKind } from '../../domain/enums/LinkRotationEnums';
import {
  decideSlugAvailability,
  hasActiveGrant,
  isPremiumSlug,
  NO_SLUG_FACTS,
  type SlugAvailability,
} from '../../domain/services/decideSlugAvailability';
import { MAX_SLUG_SUGGESTIONS, normalizeSlug, suggestSlugs, validateSlug } from '../../domain/services/slugRules';
import {
  LinkDomainInvalidError,
  LinkSlugReservedError,
  LinkSlugTakenError,
} from '../../../../shared/errors/internal/LinkRotationErrors';

/** Candidatas checadas de uma vez no banco; as primeiras livres viram sugestão. */
const SUGGESTION_POOL = 30;

type Db = PrismaClient | TransactionClient;
type DomainNames = { id: string; reservedNames: string[]; premiumNames: string[] };

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

const ownerWhere = (kind: PublicSlugKind, ownerId: string) =>
  kind === PublicSlugKind.LINK_ROTATION ? { linkRotationId: ownerId } : { storefrontId: ownerId };

/**
 * Namespace público `<slug>.<domínio>` (`public_slug_claims`). Construído com o client normal
 * (leituras) ou com o `TransactionClient` do `runInSlugTransaction` (escritas no tx do dono).
 * O unique (domainId, slug) do claim cobre claim × claim; reserva e premium são relidos no tx.
 */
export class PrismaPublicSlugRegistry implements IPublicSlugRegistry {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async check(tenantId: string, domainId: string, raw: string): Promise<SlugAvailability> {
    const domain = await this.domain(domainId);
    const slug = normalizeSlug(raw);
    const facts = validateSlug(raw, domain.reservedNames).kind === 'ok'
      ? await this.facts(domainId, slug)
      : NO_SLUG_FACTS;
    const decision = decideSlugAvailability({
      raw, tenantId, reservedNames: domain.reservedNames, premiumNames: domain.premiumNames, facts, now: this.now(),
    });
    const suggestions = decision.status === 'INVALID' || decision.status === 'AVAILABLE'
      ? []
      : await this.suggestFor(tenantId, domain, slug);
    return { ...decision, suggestions };
  }

  async suggest(tenantId: string, domainId: string, raw: string): Promise<string[]> {
    return this.suggestFor(tenantId, await this.domain(domainId), normalizeSlug(raw));
  }

  async claim(input: ClaimPublicSlugInput): Promise<void> {
    await this.guardWrite(input.tenantId, input.domainId, input.slug);
    try {
      await this.db.publicSlugClaim.create({
        data: {
          domainId: input.domainId,
          slug: input.slug,
          kind: input.kind,
          tenantId: input.tenantId,
          ...ownerWhere(input.kind, input.ownerId),
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new LinkSlugTakenError([]);
      throw err;
    }
  }

  async move(input: MovePublicSlugInput): Promise<void> {
    const { tenantId, kind, ownerId, newDomainId, newSlug } = input;
    const old = await this.currentLocation(tenantId, kind, ownerId);
    if (old && old.domainId === newDomainId && old.slug === newSlug) return;
    await this.guardWrite(tenantId, newDomainId, newSlug);
    try {
      const { count } = await this.db.publicSlugClaim.updateMany({
        where: { tenantId, ...ownerWhere(kind, ownerId) },
        data: { domainId: newDomainId, slug: newSlug },
      });
      if (count === 0) {
        // Janela de deploy: dono sem claim ainda; nasce já no endereço novo.
        await this.db.publicSlugClaim.create({
          data: { domainId: newDomainId, slug: newSlug, kind, tenantId, ...ownerWhere(kind, ownerId) },
        });
      }
    } catch (err) {
      if (isUniqueViolation(err)) throw new LinkSlugTakenError([]);
      throw err;
    }
    if (old) await this.reserve(old.domainId, old.slug, tenantId, input.reserveUntil);
  }

  async release(input: ReleasePublicSlugInput): Promise<void> {
    const { tenantId, kind, ownerId } = input;
    const old = await this.currentLocation(tenantId, kind, ownerId);
    if (old) await this.reserve(old.domainId, old.slug, tenantId, input.reserveUntil);
    await this.db.publicSlugClaim.deleteMany({ where: { tenantId, ...ownerWhere(kind, ownerId) } });
  }

  private async domain(domainId: string): Promise<DomainNames> {
    const domain = await this.db.linkDomain.findUnique({
      where: { id: domainId },
      select: { id: true, reservedNames: true, premiumNames: true },
    });
    if (!domain) throw new LinkDomainInvalidError('Link domain not available');
    return domain;
  }

  private async facts(domainId: string, slug: string) {
    const key = { domainId_slug: { domainId, slug } };
    const [claim, rotation, reservation, grant] = await Promise.all([
      this.db.publicSlugClaim.findUnique({
        where: key,
        select: { tenantId: true, kind: true, linkRotationId: true, storefrontId: true },
      }),
      this.db.linkRotation.findUnique({ where: key, select: { id: true } }),
      this.db.linkSlugReservation.findUnique({ where: key, select: { tenantId: true, expiresAt: true } }),
      this.db.premiumSlugGrant.findUnique({ where: key, select: { tenantId: true, expiresAt: true } }),
    ]);
    return {
      claim: claim && {
        tenantId: claim.tenantId,
        kind: claim.kind as PublicSlugKind,
        ownerId: (claim.linkRotationId ?? claim.storefrontId)!,
      },
      unclaimedRotation: !claim && !!rotation,
      reservation,
      grant,
    };
  }

  /** Releitura dentro do tx: reserva de outro tenant ou premium sem grant (corrida com release/revogação). */
  private async guardWrite(tenantId: string, domainId: string, slug: string): Promise<void> {
    const key = { domainId_slug: { domainId, slug } };
    const now = this.now();
    const [domain, reservation, grant] = await Promise.all([
      this.domain(domainId),
      this.db.linkSlugReservation.findUnique({ where: key, select: { tenantId: true, expiresAt: true } }),
      this.db.premiumSlugGrant.findUnique({ where: key, select: { tenantId: true, expiresAt: true } }),
    ]);
    if (reservation && reservation.tenantId !== tenantId && reservation.expiresAt > now) {
      throw new LinkSlugTakenError([]);
    }
    if (isPremiumSlug(slug, domain.premiumNames) && !hasActiveGrant(grant, tenantId, now)) {
      throw new LinkSlugReservedError(slug);
    }
    if (reservation?.tenantId === tenantId) {
      await this.db.linkSlugReservation.deleteMany({ where: { domainId, slug, tenantId } });
    }
  }

  /** Endereço atual do dono: claim; sem claim (janela de deploy), a linha do rodízio. */
  private async currentLocation(tenantId: string, kind: PublicSlugKind, ownerId: string) {
    const claim = await this.db.publicSlugClaim.findFirst({
      where: { tenantId, ...ownerWhere(kind, ownerId) },
      select: { domainId: true, slug: true },
    });
    if (claim || kind !== PublicSlugKind.LINK_ROTATION) return claim;
    return this.db.linkRotation.findFirst({ where: { id: ownerId, tenantId }, select: { domainId: true, slug: true } });
  }

  /** Upsert por (domainId, slug): reserva vencida de outro tenant é tomada pelo novo dono. */
  private async reserve(domainId: string, slug: string, tenantId: string, expiresAt: Date): Promise<void> {
    await this.db.linkSlugReservation.upsert({
      where: { domainId_slug: { domainId, slug } },
      create: { domainId, slug, tenantId, expiresAt },
      update: { tenantId, expiresAt },
    });
  }

  private async suggestFor(tenantId: string, domain: DomainNames, slug: string): Promise<string[]> {
    const pool = suggestSlugs(slug, {
      extraReserved: [...domain.reservedNames, ...domain.premiumNames],
      limit: SUGGESTION_POOL,
    });
    if (pool.length === 0) return [];
    const where = { domainId: domain.id, slug: { in: pool } };
    const [claims, rotations, reservations] = await Promise.all([
      this.db.publicSlugClaim.findMany({ where, select: { slug: true } }),
      this.db.linkRotation.findMany({ where, select: { slug: true } }),
      this.db.linkSlugReservation.findMany({
        where: { ...where, tenantId: { not: tenantId }, expiresAt: { gt: this.now() } },
        select: { slug: true },
      }),
    ]);
    const taken = new Set([...claims, ...rotations, ...reservations].map((r) => r.slug));
    return pool.filter((s) => !taken.has(s)).slice(0, MAX_SLUG_SUGGESTIONS);
  }
}
