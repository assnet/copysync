import { prisma } from '../../database/prisma.client';
import { ForbiddenError } from '../../errors/internal/AuthErrors';
import { TenantSuspendedError } from '../../errors/internal/TeamErrors';
import type { TenantContext } from '../../types/TenantContext';

/**
 * Resolves membership for a (userId, tenantId) pair.
 * Single source of truth for tenant status + membership validation.
 * Used by tenantHook (HTTP) and sseAuthHook (WS/SSE).
 */
export async function resolveMembership(
  userId: string,
  tenantId: string,
  isSuperAdmin: boolean,
): Promise<TenantContext> {
  if (isSuperAdmin) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true },
    });

    if (!tenant) {
      throw new ForbiddenError(`Tenant not found: ${tenantId}`);
    }
    if (tenant.status !== 'ACTIVE') {
      throw new TenantSuspendedError();
    }

    return {
      userId,
      tenantId,
      role: 'SUPER_ADMIN',
      isSuperAdmin: true,
    };
  }

  const membership = await prisma.userTenant.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    include: { tenant: { select: { status: true } } },
  });

  if (!membership) {
    throw new ForbiddenError('You do not have access to this tenant');
  }

  if (membership.tenant.status !== 'ACTIVE') {
    throw new TenantSuspendedError();
  }

  return {
    userId,
    tenantId,
    role: membership.role as 'ADMIN' | 'OPERATOR',
    isSuperAdmin: false,
  };
}
