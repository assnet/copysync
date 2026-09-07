import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaSessionMapper } from '../mappers/PrismaSessionMapper';
import { SessionNotFoundError } from '../../../../shared/errors/internal/SessionErrors';
import type {
  ISessionRepository,
  SessionCreateData,
  SessionStatusUpdate,
} from '../../domain/contracts/ISessionRepository';
import type { Session } from '../../domain/entities/Session';

export class PrismaSessionRepository implements ISessionRepository {
  async create(data: SessionCreateData): Promise<Session> {
    const raw = await prisma.session.create({
      data: {
        tenantId: data.tenantId,
        name: data.name,
        engine: data.engine,
        status: 'PENDING',
      },
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

  async findActiveSessionsForBootstrap(): Promise<Session[]> {
    const rows = await prisma.session.findMany({
      where: {
        deletedAt: null,
        status: { in: ['CONNECTING', 'AWAITING_QR', 'AWAITING_PAIRING', 'CONNECTED'] },
      },
    });
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
      },
    });

    if (result.count === 0) throw new SessionNotFoundError(id);

    const raw = await prisma.session.findUniqueOrThrow({ where: { id } });
    return PrismaSessionMapper.toDomain(raw);
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
