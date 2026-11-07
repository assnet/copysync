import { Prisma, type PrismaClient } from '@prisma/client';
import type { IRedirectLinkRepository, RedirectLinkData } from '../../domain/contracts/IRedirectLinkRepository';
import type { RedirectLink, RedirectSide } from '../../domain/entities/RedirectLink';
import {
  RedirectLinkNotFoundError,
  RedirectLinkSlugTakenError,
} from '../../../../shared/errors/internal/RedirectLinkErrors';
import { PrismaRedirectLinkMapper } from '../mappers/PrismaRedirectLinkMapper';

const prismaCode = (err: unknown): string | null =>
  err instanceof Prisma.PrismaClientKnownRequestError ? err.code : null;

function translate(err: unknown): never {
  const code = prismaCode(err);
  if (code === 'P2002') throw new RedirectLinkSlugTakenError();
  if (code === 'P2025') throw new RedirectLinkNotFoundError();
  throw err;
}

/** Links da plataforma. Recurso global (sem tenantId): só super-admin e rota pública. */
export class PrismaRedirectLinkRepository implements IRedirectLinkRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<RedirectLink[]> {
    const rows = await this.prisma.redirectLink.findMany({ orderBy: { slug: 'asc' } });
    return rows.map(PrismaRedirectLinkMapper.toDomain);
  }

  async findById(id: string): Promise<RedirectLink | null> {
    const row = await this.prisma.redirectLink.findUnique({ where: { id } });
    return row ? PrismaRedirectLinkMapper.toDomain(row) : null;
  }

  async findBySlug(slug: string): Promise<RedirectLink | null> {
    const row = await this.prisma.redirectLink.findUnique({ where: { slug } });
    return row ? PrismaRedirectLinkMapper.toDomain(row) : null;
  }

  async findActiveBySlug(slug: string): Promise<RedirectLink | null> {
    const row = await this.prisma.redirectLink.findFirst({ where: { slug, isActive: true } });
    return row ? PrismaRedirectLinkMapper.toDomain(row) : null;
  }

  async create(data: RedirectLinkData): Promise<RedirectLink> {
    try {
      return PrismaRedirectLinkMapper.toDomain(await this.prisma.redirectLink.create({ data }));
    } catch (err) {
      return translate(err);
    }
  }

  async update(id: string, data: RedirectLinkData): Promise<RedirectLink> {
    try {
      return PrismaRedirectLinkMapper.toDomain(await this.prisma.redirectLink.update({ where: { id }, data }));
    } catch (err) {
      return translate(err);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.prisma.redirectLink.delete({ where: { id } });
    } catch (err) {
      translate(err);
    }
  }

  async incrementHit(id: string, side: RedirectSide): Promise<void> {
    // SQL fixo por lado (sem interpolar coluna) e sem tocar `updatedAt`: clique não é edição.
    if (side === 'B') {
      await this.prisma.$executeRaw`UPDATE "redirect_links" SET "hitsB" = "hitsB" + 1 WHERE "id" = ${id}`;
    } else {
      await this.prisma.$executeRaw`UPDATE "redirect_links" SET "hitsA" = "hitsA" + 1 WHERE "id" = ${id}`;
    }
  }
}
