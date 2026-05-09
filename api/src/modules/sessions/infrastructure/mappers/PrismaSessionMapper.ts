import type { Session as PrismaSession } from '@prisma/client';
import { Session } from '../../domain/entities/Session';
import type { SessionStatus } from '../../domain/enums/SessionStatus';

export class PrismaSessionMapper {
  static toDomain(raw: PrismaSession): Session {
    return new Session({
      id: raw.id,
      tenantId: raw.tenantId,
      name: raw.name,
      engine: raw.engine,
      phone: raw.phone,
      externalRef: raw.externalRef,
      status: raw.status as SessionStatus,
      lastConnectedAt: raw.lastConnectedAt,
      lastDisconnectedAt: raw.lastDisconnectedAt,
      lastSeenAt: raw.lastSeenAt,
      deletedAt: raw.deletedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }
}
