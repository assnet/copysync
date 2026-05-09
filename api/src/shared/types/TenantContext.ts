/**
 * Represents the authenticated context resolved from the JWT on each request.
 * Injected by authHook into request.tenantContext.
 */
export interface TenantContext {
  userId: string;
  tenantId: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR';
  isSuperAdmin: boolean;
}
