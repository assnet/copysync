import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  CreateLinkRotationInput,
  ILinkRotationRepository,
  PublicLinkRotation,
  SaveLinkRotationGroupInput,
  UpdateLinkRotationInput,
} from '../../domain/contracts/ILinkRotationRepository';
import type { LinkRotation, LinkRotationWithGroups } from '../../domain/entities/LinkRotation';
import type { LinkRotationGroup } from '../../domain/entities/LinkRotationGroup';
import { LinkRotationNotFoundError, LinkSlugTakenError } from '../../../../shared/errors/internal/LinkRotationErrors';
import { PrismaLinkDomainMapper } from '../mappers/PrismaLinkDomainMapper';
import { PrismaLinkRotationMapper } from '../mappers/PrismaLinkRotationMapper';

const GROUPS_ORDER = { orderBy: { position: 'asc' as const } };

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * Unique (domainId, slug) violado em corrida → `LinkSlugTakenError` com `suggestions: []`.
 * O repositório não gera sugestões: o use case captura o erro e relança com nomes livres
 * (slugRules + isSlugAvailable).
 */
function rethrowSlugTaken(err: unknown): never {
  if (isUniqueViolation(err)) throw new LinkSlugTakenError([]);
  throw err;
}

/** Rotações do tenant. Tudo tenant-aware, exceto `findPublicByHost`/`incrementClick` (rota pública). */
export class PrismaLinkRotationRepository implements ILinkRotationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listByTenant(tenantId: string): Promise<LinkRotationWithGroups[]> {
    const rows = await this.prisma.linkRotation.findMany({
      where: { tenantId },
      include: { groups: GROUPS_ORDER },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(PrismaLinkRotationMapper.toDomainWithGroups);
  }

  async findById(tenantId: string, id: string): Promise<LinkRotationWithGroups | null> {
    const row = await this.prisma.linkRotation.findFirst({ where: { id, tenantId }, include: { groups: GROUPS_ORDER } });
    return row ? PrismaLinkRotationMapper.toDomainWithGroups(row) : null;
  }

  async countByTenant(tenantId: string): Promise<number> {
    return this.prisma.linkRotation.count({ where: { tenantId } });
  }

  async create(input: CreateLinkRotationInput): Promise<LinkRotation> {
    try {
      const row = await this.prisma.linkRotation.create({
        data: {
          tenantId: input.tenantId,
          sessionId: input.sessionId,
          domainId: input.domainId,
          slug: input.slug,
          ...(input.strategy && { strategy: input.strategy }),
          title: input.title ?? null,
        },
      });
      return PrismaLinkRotationMapper.toDomain(row);
    } catch (err) {
      rethrowSlugTaken(err);
    }
  }

  async update(tenantId: string, id: string, input: UpdateLinkRotationInput): Promise<LinkRotation> {
    try {
      const { count } = await this.prisma.linkRotation.updateMany({
        where: { id, tenantId },
        data: {
          ...(input.slug !== undefined && { slug: input.slug }),
          ...(input.domainId !== undefined && { domainId: input.domainId }),
          ...(input.status !== undefined && { status: input.status }),
          ...(input.strategy !== undefined && { strategy: input.strategy }),
          ...(input.title !== undefined && { title: input.title }),
        },
      });
      if (count === 0) throw new LinkRotationNotFoundError(id);
    } catch (err) {
      rethrowSlugTaken(err);
    }
    const row = await this.prisma.linkRotation.findFirst({ where: { id, tenantId } });
    if (!row) throw new LinkRotationNotFoundError(id);
    return PrismaLinkRotationMapper.toDomain(row);
  }

  /** Grupos e cliques caem por cascade. A reserva do slug é do use case (`reserveSlug`). */
  async delete(tenantId: string, id: string): Promise<void> {
    const { count } = await this.prisma.linkRotation.deleteMany({ where: { id, tenantId } });
    if (count === 0) throw new LinkRotationNotFoundError(id);
  }

  /**
   * Substitui o conjunto de grupos numa transação. Grupo que permanece (mesmo `conversationId`)
   * é atualizado no lugar: mantém id, clickCount, clicksSinceSync, memberCount, memberCountAt e
   * lastClickAt; recebe position/weight/capacity/inviteCode/linkSource/status do input.
   * Os que saíram são apagados (LinkClick.groupId vira null) e os novos são criados.
   */
  async replaceGroups(
    tenantId: string,
    rotationId: string,
    groups: SaveLinkRotationGroupInput[],
  ): Promise<LinkRotationGroup[]> {
    return this.prisma.$transaction(async (tx) => {
      const rotation = await tx.linkRotation.findFirst({ where: { id: rotationId, tenantId }, select: { id: true } });
      if (!rotation) throw new LinkRotationNotFoundError(rotationId);

      const existing = await tx.linkRotationGroup.findMany({
        where: { rotationId, tenantId },
        select: { id: true, conversationId: true },
      });
      const keep = new Set(groups.map((g) => g.conversationId));
      const byConversation = new Map(existing.map((g) => [g.conversationId, g.id]));

      const removed = existing.filter((g) => !keep.has(g.conversationId)).map((g) => g.id);
      if (removed.length > 0) {
        await tx.linkRotationGroup.deleteMany({ where: { id: { in: removed }, rotationId, tenantId } });
      }

      for (const g of groups) {
        const fields = {
          groupJid: g.groupJid,
          position: g.position,
          weight: g.weight,
          capacity: g.capacity,
          inviteCode: g.inviteCode,
          linkSource: g.linkSource,
          status: g.status,
        };
        const currentId = byConversation.get(g.conversationId);
        if (currentId) {
          await tx.linkRotationGroup.updateMany({ where: { id: currentId, rotationId, tenantId }, data: fields });
        } else {
          await tx.linkRotationGroup.create({
            data: { ...fields, tenantId, rotationId, conversationId: g.conversationId },
          });
        }
      }

      const rows = await tx.linkRotationGroup.findMany({ where: { rotationId, tenantId }, ...GROUPS_ORDER });
      return rows.map(PrismaLinkRotationMapper.groupToDomain);
    });
  }

  /**
   * ÚNICA consulta do módulo sem tenantId: a rota pública não tem sessão nem token, quem
   * decide o tenant é o Host (hostname do domínio + slug, unique). Só domínio ACTIVE.
   * `tenantActive` = Tenant.status === 'ACTIVE' (SUSPENDED/CANCELLED → página indisponível).
   */
  async findPublicByHost(hostname: string, slug: string): Promise<PublicLinkRotation | null> {
    const domain = await this.prisma.linkDomain.findUnique({ where: { hostname: hostname.trim().toLowerCase() } });
    if (!domain || domain.status !== 'ACTIVE') return null;
    const row = await this.prisma.linkRotation.findUnique({
      where: { domainId_slug: { domainId: domain.id, slug: slug.trim().toLowerCase() } },
      include: { groups: GROUPS_ORDER, tenant: { select: { status: true } } },
    });
    if (!row) return null;
    const { tenant, ...rotation } = row;
    return {
      rotation: PrismaLinkRotationMapper.toDomainWithGroups(rotation),
      domain: PrismaLinkDomainMapper.toDomain(domain),
      tenantActive: tenant.status === 'ACTIVE',
    };
  }

  /**
   * Atômico: `SET col = col + 1` no banco (increment do Prisma), nunca ler-somar-gravar.
   * O grupo precisa pertencer à rotação; senão nada é contado (transação desfeita).
   */
  async incrementClick(rotationId: string, groupId: string, at: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.linkRotationGroup.updateMany({
        where: { id: groupId, rotationId },
        data: { clickCount: { increment: 1 }, clicksSinceSync: { increment: 1 }, lastClickAt: at },
      });
      if (count === 0) throw new LinkRotationNotFoundError(rotationId);
      await tx.linkRotation.update({
        where: { id: rotationId },
        data: { clickCount: { increment: 1 }, lastClickAt: at },
      });
    });
  }

  /** Livre = sem rotação em (domínio, slug) e sem reserva vigente de OUTRO tenant (a própria não bloqueia). */
  async isSlugAvailable(domainId: string, slug: string, tenantId: string): Promise<boolean> {
    const [used, reserved] = await Promise.all([
      this.prisma.linkRotation.count({ where: { domainId, slug } }),
      this.prisma.linkSlugReservation.count({
        where: { domainId, slug, tenantId: { not: tenantId }, expiresAt: { gt: new Date() } },
      }),
    ]);
    return used === 0 && reserved === 0;
  }

  /** Upsert por (domainId, slug): reserva vencida de outro tenant é tomada pelo novo dono. */
  async reserveSlug(domainId: string, slug: string, tenantId: string, expiresAt: Date): Promise<void> {
    await this.prisma.linkSlugReservation.upsert({
      where: { domainId_slug: { domainId, slug } },
      create: { domainId, slug, tenantId, expiresAt },
      update: { tenantId, expiresAt },
    });
  }
}
