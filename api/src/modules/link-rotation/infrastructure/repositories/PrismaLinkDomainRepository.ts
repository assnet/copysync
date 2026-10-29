import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  CreateLinkDomainInput,
  ILinkDomainRepository,
  UpdateLinkDomainInput,
} from '../../domain/contracts/ILinkDomainRepository';
import type { LinkDomain } from '../../domain/entities/LinkDomain';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { LinkDomainInUseError } from '../../../../shared/errors/internal/LinkRotationErrors';
import { PrismaLinkDomainMapper } from '../mappers/PrismaLinkDomainMapper';

/** Hostname sempre minúsculo e sem ponto final (formato validado no use case). */
const normalizeHost = (h: string): string => h.trim().toLowerCase().replace(/\.+$/, '');

const isNotFound = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025';

/** Domínios de links da plataforma. Recurso global (sem tenantId): só super-admin e rota pública. */
export class PrismaLinkDomainRepository implements ILinkDomainRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<LinkDomain[]> {
    const rows = await this.prisma.linkDomain.findMany({ orderBy: { hostname: 'asc' } });
    return rows.map(PrismaLinkDomainMapper.toDomain);
  }

  async listActive(): Promise<LinkDomain[]> {
    const rows = await this.prisma.linkDomain.findMany({ where: { status: 'ACTIVE' }, orderBy: { hostname: 'asc' } });
    return rows.map(PrismaLinkDomainMapper.toDomain);
  }

  async findById(id: string): Promise<LinkDomain | null> {
    const row = await this.prisma.linkDomain.findUnique({ where: { id } });
    return row ? PrismaLinkDomainMapper.toDomain(row) : null;
  }

  async findByHostname(hostname: string): Promise<LinkDomain | null> {
    const row = await this.prisma.linkDomain.findUnique({ where: { hostname: normalizeHost(hostname) } });
    return row ? PrismaLinkDomainMapper.toDomain(row) : null;
  }

  async create(input: CreateLinkDomainInput): Promise<LinkDomain> {
    const row = await this.prisma.linkDomain.create({
      data: {
        hostname: normalizeHost(input.hostname),
        landingUrl: input.landingUrl ?? null,
        reservedNames: input.reservedNames ?? [],
      },
    });
    return PrismaLinkDomainMapper.toDomain(row);
  }

  async update(id: string, input: UpdateLinkDomainInput): Promise<LinkDomain> {
    try {
      const row = await this.prisma.linkDomain.update({
        where: { id },
        data: {
          ...(input.status !== undefined && { status: input.status }),
          ...(input.landingUrl !== undefined && { landingUrl: input.landingUrl }),
          ...(input.reservedNames !== undefined && { reservedNames: input.reservedNames }),
        },
      });
      return PrismaLinkDomainMapper.toDomain(row);
    } catch (err) {
      if (isNotFound(err)) throw new NotFoundError('LinkDomain', id);
      throw err;
    }
  }

  /** onDelete: Restrict nas rotações; o use case checa `countRotations` antes (LINK_DOMAIN_IN_USE). */
  async delete(id: string): Promise<void> {
    try {
      const { count } = await this.prisma.linkDomain.deleteMany({ where: { id } });
      if (count === 0) throw new NotFoundError('LinkDomain', id);
    } catch (err) {
      // Rotação criada entre a contagem do use case e o delete: FK Restrict (P2003) vira 409.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') throw new LinkDomainInUseError(id);
      throw err;
    }
  }

  async countRotations(id: string): Promise<number> {
    return this.prisma.linkRotation.count({ where: { domainId: id } });
  }

  async recordProbe(id: string, ok: boolean, at: Date): Promise<void> {
    await this.prisma.linkDomain.updateMany({ where: { id }, data: { lastProbeOk: ok, lastProbeAt: at } });
  }
}
