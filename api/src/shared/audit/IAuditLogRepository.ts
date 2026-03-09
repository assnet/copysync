/**
 * Contract for recording auditable events.
 * Values mirror the Prisma AuditAction enum — no @prisma/client import here.
 */
export type AuditAction =
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_LOGGED_IN'
  | 'USER_LOGGED_OUT'
  | 'TENANT_CREATED'
  | 'TENANT_UPDATED'
  | 'TENANT_SUSPENDED'
  | 'SESSION_CREATED'
  | 'SESSION_CONNECTED'
  | 'SESSION_DISCONNECTED'
  | 'SESSION_LOGGED_OUT';

export interface CreateAuditLogInput {
  tenantId?: string;
  userId?: string;
  action: AuditAction;
  meta?: Record<string, unknown>;
}

export interface IAuditLogRepository {
  create(input: CreateAuditLogInput): Promise<void>;
}
