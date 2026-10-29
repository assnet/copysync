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
  | 'SESSION_LOGGED_OUT'
  | 'SESSION_DELETED'
  | 'AFFILIATE_CREDENTIAL_UPSERTED'
  | 'AFFILIATE_CREDENTIAL_DELETED'
  | 'AFFILIATE_SESSION_SYNCED'
  | 'INVITE_ACCEPTED'
  | 'MEMBER_INVITED'
  | 'MEMBER_CREATED'
  | 'MEMBER_DEACTIVATED'
  | 'MEMBER_ROLE_CHANGED'
  | 'TENANT_STATUS_CHANGED'
  | 'BILLING_EVENT_RECEIVED'
  | 'AFFILIATE_SESSION_ACCOUNT_RESET'
  | 'AFFILIATE_CREDENTIAL_REJECTED'
  | 'PREMIUM_SLUG_GRANTED'
  | 'PREMIUM_SLUG_REVOKED';

export interface CreateAuditLogInput {
  tenantId?: string;
  userId?: string;
  action: AuditAction;
  meta?: Record<string, unknown>;
}

export interface IAuditLogRepository {
  create(input: CreateAuditLogInput): Promise<void>;
}
