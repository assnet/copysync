import type { AuditAction as PrismaAuditAction } from '@prisma/client';
import { prisma } from '../database/prisma.client';
import type { IAuditLogRepository, CreateAuditLogInput } from './IAuditLogRepository';

export class PrismaAuditLogRepository implements IAuditLogRepository {
  async create(input: CreateAuditLogInput): Promise<void> {
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId ?? null,
        userId: input.userId ?? null,
        action: input.action as PrismaAuditAction,
        meta: input.meta as object | undefined,
      },
    });
  }
}
