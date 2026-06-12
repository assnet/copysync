import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma.client';
import type {
  ISessionAuthStateRepository,
  SessionAuthStateRecord,
  SessionAuthStateUpsertData,
} from '../../domain/contracts/ISessionAuthStateRepository';

export class PrismaSessionAuthStateRepository implements ISessionAuthStateRepository {
  async findBySessionId(sessionId: string): Promise<SessionAuthStateRecord | null> {
    const raw = await prisma.sessionAuthState.findUnique({ where: { sessionId } });
    if (!raw) return null;
    return {
      sessionId: raw.sessionId,
      tenantId: raw.tenantId,
      provider: raw.provider,
      statePayload: raw.statePayload,
      version: raw.version,
    };
  }

  async upsert(data: SessionAuthStateUpsertData): Promise<void> {
    await prisma.sessionAuthState.upsert({
      where: { sessionId: data.sessionId },
      create: {
        sessionId: data.sessionId,
        tenantId: data.tenantId,
        provider: data.provider,
        statePayload: data.statePayload as Prisma.InputJsonValue,
        version: 0,
      },
      update: {
        statePayload: data.statePayload as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
  }

  async clearCredentials(sessionId: string): Promise<void> {
    await prisma.sessionAuthState.updateMany({
      where: { sessionId },
      data: {
        statePayload: {},
        version: { increment: 1 },
      },
    });
  }

  async deleteBySessionId(sessionId: string): Promise<void> {
    // deleteMany — silently no-ops when record does not exist
    await prisma.sessionAuthState.deleteMany({ where: { sessionId } });
  }
}
