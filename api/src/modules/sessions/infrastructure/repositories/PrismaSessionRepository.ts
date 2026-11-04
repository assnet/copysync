import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaSessionMapper } from '../mappers/PrismaSessionMapper';
import { SessionNotFoundError } from '../../../../shared/errors/internal/SessionErrors';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import type {
  ISessionRepository,
  SessionCreateData,
  SessionLimit,
  SessionStatusUpdate,
} from '../../domain/contracts/ISessionRepository';
import type { Session } from '../../domain/entities/Session';

/** Status com socket aberto ou abrindo (sessão a restaurar no boot). */
const ACTIVE_STATUSES = ['CONNECTING', 'AWAITING_QR', 'AWAITING_PAIRING', 'AWAITING_CODE', 'AWAITING_PASSWORD', 'CONNECTED'] as const;

export class PrismaSessionRepository implements ISessionRepository {
  async create(data: SessionCreateData): Promise<Session> {
    const raw = await prisma.session.create({
      data: {
        tenantId: data.tenantId,
        name: data.name,
        engine: data.engine,
        declaredPhone: data.declaredPhone ?? null,
        status: 'PENDING',
      },
    });
    return PrismaSessionMapper.toDomain(raw);
  }

  async createWithinLimit(data: SessionCreateData, limit: SessionLimit): Promise<Session> {
    const raw = await prisma.$transaction(async (tx) => {
      // Chave própria: não disputa o lock da cota de ofertas do mesmo tenant
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'session-limit:' + data.tenantId}::text))`;
      const used = await tx.session.count({ where: { tenantId: data.tenantId, engine: limit.engine, deletedAt: null } });
      if (used >= limit.limit) throw new PlanLimitReachedError(limit.key, limit.limit);
      return tx.session.create({
        data: {
          tenantId: data.tenantId,
          name: data.name,
          engine: data.engine,
          declaredPhone: data.declaredPhone ?? null,
          status: 'PENDING',
        },
      });
    });
    return PrismaSessionMapper.toDomain(raw);
  }

  async findById(id: string, tenantId: string): Promise<Session | null> {
    const raw = await prisma.session.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    return raw ? PrismaSessionMapper.toDomain(raw) : null;
  }

  async findAllByTenant(tenantId: string): Promise<Session[]> {
    const rows = await prisma.session.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(PrismaSessionMapper.toDomain);
  }

  async countByEngine(tenantId: string): Promise<Record<string, number>> {
    const rows = await prisma.session.groupBy({
      by: ['engine'],
      where: { tenantId, deletedAt: null },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.engine, r._count._all]));
  }

  async findEngineById(id: string): Promise<string | null> {
    const raw = await prisma.session.findUnique({ where: { id }, select: { engine: true } });
    return raw?.engine ?? null;
  }

  async findActiveSessionsForBootstrap(): Promise<Session[]> {
    const rows = await prisma.session.findMany({
      where: {
        deletedAt: null,
        status: { in: [...ACTIVE_STATUSES] },
      },
    });
    return rows.map(PrismaSessionMapper.toDomain);
  }

  async findActiveSessionsWithoutLiveLease(): Promise<Session[]> {
    // Relógio do banco em UTC (colunas `timestamp` sem fuso gravadas em UTC), como no lease.
    const ids = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "sessions"
      WHERE "deletedAt" IS NULL
        AND "status"::text IN (${Prisma.join([...ACTIVE_STATUSES])})
        AND ("leaseUntil" IS NULL OR "leaseUntil" < (now() AT TIME ZONE 'UTC'))`;
    if (ids.length === 0) return [];
    const rows = await prisma.session.findMany({ where: { id: { in: ids.map((r) => r.id) } } });
    return rows.map(PrismaSessionMapper.toDomain);
  }

  /**
   * Updates status and optional timestamps.
   * The caller (use case) must pre-validate tenantId ownership via findById.
   */
  async updateStatus(id: string, tenantId: string, update: SessionStatusUpdate): Promise<Session> {
    // updateMany filters by both id AND tenantId for defense-in-depth.
    const result = await prisma.session.updateMany({
      where: { id, tenantId },
      data: {
        status: update.status,
        ...(update.lastConnectedAt !== undefined && { lastConnectedAt: update.lastConnectedAt }),
        ...(update.lastDisconnectedAt !== undefined && {
          lastDisconnectedAt: update.lastDisconnectedAt,
        }),
        ...(update.clearConnectRequest === true && { connectRequestedAt: null }),
      },
    });

    if (result.count === 0) throw new SessionNotFoundError(id);

    const raw = await prisma.session.findUniqueOrThrow({ where: { id } });
    return PrismaSessionMapper.toDomain(raw);
  }

  async markConnectRequested(id: string, tenantId: string): Promise<void> {
    // COALESCE atômico: só grava quando ainda não há pedido (preserva o horário original).
    await prisma.session.updateMany({
      where: { id, tenantId, deletedAt: null, connectRequestedAt: null },
      data: { connectRequestedAt: new Date() },
    });
  }

  async updatePhone(id: string, tenantId: string, phone: string): Promise<Session> {
    const result = await prisma.session.updateMany({
      where: { id, tenantId },
      data: { phone },
    });
    if (result.count === 0) throw new SessionNotFoundError(id);
    const raw = await prisma.session.findUniqueOrThrow({ where: { id } });
    return PrismaSessionMapper.toDomain(raw);
  }

  async updateExternalRef(id: string, tenantId: string, externalRef: string): Promise<Session> {
    const result = await prisma.session.updateMany({
      where: { id, tenantId },
      data: { externalRef },
    });
    if (result.count === 0) throw new SessionNotFoundError(id);
    const raw = await prisma.session.findUniqueOrThrow({ where: { id } });
    return PrismaSessionMapper.toDomain(raw);
  }

  async softDelete(id: string, tenantId: string): Promise<void> {
    await prisma.session.updateMany({
      where: { id, tenantId },
      data: { deletedAt: new Date() },
    });
  }
}
