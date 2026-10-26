import { logger } from '../../../shared/logger/logger';
import type { IAiAuditTrail } from '../domain/contracts/IAiAuditTrail';

/**
 * Trilha de auditoria em log estruturado. O enum Prisma `AuditAction` ainda não tem as ações
 * `AI_*`; quando ganhar (migration própria), trocar por um adapter de `IAuditLogRepository`.
 * `meta` nunca leva chave.
 */
export class LoggerAiAuditTrail implements IAiAuditTrail {
  async record(input: Parameters<IAiAuditTrail['record']>[0]): Promise<void> {
    logger.info({ audit: input.action, userId: input.userId, tenantId: input.tenantId, meta: input.meta }, 'ai:audit');
  }
}
