import type { AuditAction as PrismaAuditAction } from '@prisma/client';
import { prisma } from '../database/prisma.client';
import type { TransactionClient } from '../database/UnitOfWork';
import type { IAuditLogRepository, CreateAuditLogInput } from './IAuditLogRepository';

export class PrismaAuditLogRepository implements IAuditLogRepository {
  private readonly db: TransactionClient;
  constructor(db?: TransactionClient) { this.db = db ?? prisma; }

  async create(input: CreateAuditLogInput): Promise<void> {
    await this.db.auditLog.create({
      data: {
        tenantId: input.tenantId ?? null,
        userId: input.userId ?? null,
        action: input.action as PrismaAuditAction,
        meta: input.meta as object | undefined,
      },
    });
  }
}
